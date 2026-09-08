"""
CloudServiceTool base class for API-based tools that replace sandbox functionality.

This base class provides common functionality for cloud-based tools that perform
operations through external APIs instead of sandbox environments. It includes:
- HTTP client management with retry logic
- Error handling and response formatting
- Rate limiting and timeout management
- Configuration management for API credentials
- Standardized response formats for cloud services

This is part of the system transformation from sandbox-based to cloud-based architecture.
"""

import asyncio
import json
import logging
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List, Union
import httpx
from datetime import datetime, timedelta

from core.tools.base import Tool, ToolResult
from core.utils.config import config
from core.utils.logger import logger


class CloudServiceError(Exception):
    """Custom exception for cloud service operations."""

    def __init__(self, message: str, status_code: Optional[int] = None, service_name: Optional[str] = None):
        self.message = message
        self.status_code = status_code
        self.service_name = service_name
        super().__init__(self.format_error())

    def format_error(self) -> str:
        """Format error message with context."""
        parts = []
        if self.service_name:
            parts.append(f"[{self.service_name}]")
        if self.status_code:
            parts.append(f"HTTP {self.status_code}")
        parts.append(self.message)
        return " ".join(parts)


class RateLimiter:
    """Simple rate limiter for API calls."""

    def __init__(self, max_calls: int = 100, time_window: timedelta = timedelta(minutes=1)):
        self.max_calls = max_calls
        self.time_window = time_window
        self.calls: List[datetime] = []

    async def acquire(self) -> bool:
        """Acquire permission to make an API call."""
        now = datetime.now()

        # Remove old calls outside the time window
        self.calls = [call_time for call_time in self.calls
                     if now - call_time <= self.time_window]

        # Check if we can make another call
        if len(self.calls) >= self.max_calls:
            # Calculate wait time
            oldest_call = min(self.calls)
            wait_time = (oldest_call + self.time_window - now).total_seconds()
            if wait_time > 0:
                logger.warning(f"Rate limit reached, waiting {wait_time:.2f} seconds")
                await asyncio.sleep(wait_time)
                return await self.acquire()

        # Record this call
        self.calls.append(now)
        return True


class CloudServiceTool(Tool, ABC):
    """
    Abstract base class for cloud-based API tools.

    Provides common functionality for tools that interact with external APIs
    instead of sandbox environments. Includes error handling, rate limiting,
    retry logic, and response formatting.
    """

    def __init__(self, service_name: str, base_url: Optional[str] = None,
                 api_key: Optional[str] = None, timeout: float = 30.0,
                 max_retries: int = 3, rate_limit_calls: int = 100):
        """
        Initialize the cloud service tool.

        Args:
            service_name: Name of the service for logging and error reporting
            base_url: Base URL for the API service
            api_key: API key for authentication
            timeout: Request timeout in seconds
            max_retries: Maximum number of retry attempts
            rate_limit_calls: Maximum API calls per minute
        """
        super().__init__()

        self.service_name = service_name
        self.base_url = base_url
        self.api_key = api_key
        self.timeout = timeout
        self.max_retries = max_retries

        # Initialize HTTP client with sensible defaults
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
            follow_redirects=True
        )

        # Initialize rate limiter
        self.rate_limiter = RateLimiter(max_calls=rate_limit_calls)

        logger.info(f"Initialized {service_name} cloud service tool")

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()

    async def close(self):
        """Close the HTTP client and cleanup resources."""
        if self.client:
            await self.client.aclose()
            logger.debug(f"Closed HTTP client for {self.service_name}")

    def get_headers(self) -> Dict[str, str]:
        """
        Get default headers for API requests.
        Override this method to customize headers for specific services.
        """
        headers = {
            "Content-Type": "application/json",
            "User-Agent": f"Aletheon-CloudTool/{self.service_name}"
        }

        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        return headers

    async def make_request(self, method: str, endpoint: str,
                          data: Optional[Dict[str, Any]] = None,
                          params: Optional[Dict[str, Any]] = None,
                          headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """
        Make an HTTP request with retry logic and error handling.

        Args:
            method: HTTP method (GET, POST, PUT, DELETE)
            endpoint: API endpoint (relative to base_url)
            data: JSON data for the request body
            params: Query parameters
            headers: Additional headers (merged with default headers)

        Returns:
            Response data as dictionary

        Raises:
            CloudServiceError: If the request fails after all retries
        """
        # Acquire rate limit permission
        await self.rate_limiter.acquire()

        # Prepare request
        url = f"{self.base_url.rstrip('/')}/{endpoint.lstrip('/')}" if self.base_url else endpoint
        request_headers = self.get_headers()
        if headers:
            request_headers.update(headers)

        # Retry logic
        last_exception = None
        for attempt in range(self.max_retries + 1):
            try:
                logger.debug(f"Making {method} request to {url} (attempt {attempt + 1}/{self.max_retries + 1})")

                response = await self.client.request(
                    method=method,
                    url=url,
                    json=data,
                    params=params,
                    headers=request_headers
                )

                # Check for successful response
                response.raise_for_status()

                # Parse JSON response
                try:
                    response_data = response.json()
                    logger.debug(f"Successful {method} request to {endpoint}")
                    return response_data
                except json.JSONDecodeError:
                    # Handle non-JSON responses
                    return {"content": response.text, "status_code": response.status_code}

            except httpx.HTTPStatusError as e:
                last_exception = CloudServiceError(
                    message=f"HTTP error: {e.response.text}",
                    status_code=e.response.status_code,
                    service_name=self.service_name
                )

                # Don't retry on client errors (4xx)
                if 400 <= e.response.status_code < 500:
                    break

            except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.NetworkError) as e:
                last_exception = CloudServiceError(
                    message=f"Network error: {str(e)}",
                    service_name=self.service_name
                )

            except Exception as e:
                last_exception = CloudServiceError(
                    message=f"Unexpected error: {str(e)}",
                    service_name=self.service_name
                )

            # Wait before retry (exponential backoff)
            if attempt < self.max_retries:
                wait_time = 2 ** attempt
                logger.warning(f"Request failed, retrying in {wait_time}s: {last_exception}")
                await asyncio.sleep(wait_time)

        # All retries failed
        logger.error(f"All retry attempts failed for {method} {endpoint}: {last_exception}")
        raise last_exception

    def format_cloud_response(self, data: Any, operation: str = "operation") -> ToolResult:
        """
        Format a successful response from a cloud service.

        Args:
            data: Response data from the cloud service
            operation: Description of the operation performed

        Returns:
            ToolResult with formatted response
        """
        if isinstance(data, dict) and "error" in data:
            return self.fail_response(f"{operation} failed: {data.get('error', 'Unknown error')}")

        response = {
            "service": self.service_name,
            "operation": operation,
            "timestamp": datetime.now().isoformat(),
            "success": True,
            "data": data
        }

        return self.success_response(response)

    def format_cloud_error(self, error: Union[str, Exception], operation: str = "operation") -> ToolResult:
        """
        Format an error response from a cloud service.

        Args:
            error: Error message or exception
            operation: Description of the operation that failed

        Returns:
            ToolResult with formatted error
        """
        if isinstance(error, CloudServiceError):
            error_msg = error.format_error()
        else:
            error_msg = str(error)

        response = {
            "service": self.service_name,
            "operation": operation,
            "timestamp": datetime.now().isoformat(),
            "success": False,
            "error": error_msg
        }

        logger.error(f"Cloud service error in {operation}: {error_msg}")
        return self.fail_response(json.dumps(response, indent=2))

    @abstractmethod
    async def validate_configuration(self) -> bool:
        """
        Validate that the tool is properly configured.

        Returns:
            True if configuration is valid, False otherwise
        """
        pass

    @abstractmethod
    def get_capabilities(self) -> Dict[str, Any]:
        """
        Get the capabilities of this cloud service tool.

        Returns:
            Dictionary describing the tool's capabilities
        """
        pass


class IntelligentCloudServiceTool(CloudServiceTool):
    """
    Enhanced cloud service tool with intelligent response processing.

    Adds AI-powered response analysis, content filtering, and result optimization
    for better user experience and more intelligent responses.
    """

    def __init__(self, service_name: str, **kwargs):
        super().__init__(service_name, **kwargs)
        self.response_cache: Dict[str, Any] = {}
        self.max_cache_size = 100

    def cache_response(self, key: str, response: Any, ttl_minutes: int = 30):
        """Cache a response for future use."""
        if len(self.response_cache) >= self.max_cache_size:
            # Remove oldest entry
            oldest_key = next(iter(self.response_cache))
            del self.response_cache[oldest_key]

        self.response_cache[key] = {
            "data": response,
            "timestamp": datetime.now(),
            "ttl_minutes": ttl_minutes
        }

    def get_cached_response(self, key: str) -> Optional[Any]:
        """Get a cached response if it's still valid."""
        if key not in self.response_cache:
            return None

        cached = self.response_cache[key]
        age = datetime.now() - cached["timestamp"]

        if age.total_seconds() > cached["ttl_minutes"] * 60:
            del self.response_cache[key]
            return None

        return cached["data"]

    def optimize_response(self, data: Any) -> Any:
        """
        Optimize response data for better presentation.

        Override this method to implement service-specific optimizations.
        """
        return data

    def extract_key_insights(self, data: Any) -> List[str]:
        """
        Extract key insights from response data.

        Override this method to implement service-specific insight extraction.
        """
        return []

    def format_intelligent_response(self, data: Any, operation: str,
                                  include_insights: bool = True) -> ToolResult:
        """
        Format response with intelligent enhancements.

        Args:
            data: Response data
            operation: Operation description
            include_insights: Whether to include extracted insights

        Returns:
            Enhanced ToolResult with optimizations and insights
        """
        # Optimize the response data
        optimized_data = self.optimize_response(data)

        response = {
            "service": self.service_name,
            "operation": operation,
            "timestamp": datetime.now().isoformat(),
            "success": True,
            "data": optimized_data
        }

        # Add insights if requested
        if include_insights:
            insights = self.extract_key_insights(optimized_data)
            if insights:
                response["insights"] = insights

        return self.success_response(response)
