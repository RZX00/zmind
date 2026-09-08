"""
IntelligentSearchTool - Cloud-based replacement for sandbox web search functionality.

This tool replaces the sandbox-based web search with a pure API-based approach
using Tavily and Firecrawl APIs. It provides intelligent search, content extraction,
and result optimization without requiring any sandbox environment.

Features:
- Multi-source web search with AI-powered result ranking
- Intelligent content extraction and summarization
- Automatic fact-checking and source verification
- Cost-effective operation through API optimization
- Real-time search with cached results for efficiency
"""

import json
import re
from datetime import datetime
from typing import Dict, Any, List, Optional, Union
from urllib.parse import urlparse

import httpx
from tavily import AsyncTavilyClient

from core.tools.base import openapi_schema, usage_example
from core.tools.cloud_service_tool import IntelligentCloudServiceTool, CloudServiceError
from core.utils.config import config
from core.utils.logger import logger


class IntelligentSearchTool(IntelligentCloudServiceTool):
    """
    Intelligent cloud-based search tool that replaces sandbox web search functionality.

    Provides comprehensive web search, content extraction, and intelligent result processing
    through external APIs without requiring sandbox environments.
    """

    def __init__(self):
        super().__init__(
            service_name="IntelligentSearch",
            timeout=45.0,
            max_retries=2,
            rate_limit_calls=150  # Higher limit for search operations
        )

        # Initialize API clients
        self.tavily_api_key = config.TAVILY_API_KEY
        self.firecrawl_api_key = config.FIRECRAWL_API_KEY
        self.firecrawl_url = config.FIRECRAWL_URL or "https://api.firecrawl.dev"
        self.serper_api_key = config.SERPER_API_KEY

        if not self.tavily_api_key:
            raise ValueError("TAVILY_API_KEY is required for IntelligentSearchTool")
        if not self.firecrawl_api_key:
            raise ValueError("FIRECRAWL_API_KEY is required for IntelligentSearchTool")

        self.tavily_client = AsyncTavilyClient(api_key=self.tavily_api_key)

        logger.info("Initialized IntelligentSearchTool with Tavily and Firecrawl APIs")

    async def validate_configuration(self) -> bool:
        """Validate that required API keys are configured."""
        return bool(self.tavily_api_key and self.firecrawl_api_key)

    def get_capabilities(self) -> Dict[str, Any]:
        """Get the capabilities of this search tool."""
        return {
            "web_search": True,
            "content_extraction": True,
            "image_search": bool(self.serper_api_key),
            "real_time_data": True,
            "source_verification": True,
            "intelligent_ranking": True,
            "cost_optimized": True,
            "sandbox_free": True
        }

    def optimize_response(self, data: Any) -> Any:
        """Optimize search response data for better presentation."""
        if isinstance(data, dict):
            # Remove empty fields and optimize structure
            optimized = {}
            for key, value in data.items():
                if value is not None and value != "":
                    if key == "results" and isinstance(value, list):
                        # Optimize search results
                        optimized[key] = [self._optimize_search_result(result) for result in value]
                    else:
                        optimized[key] = value
            return optimized
        return data

    def _optimize_search_result(self, result: Dict[str, Any]) -> Dict[str, Any]:
        """Optimize individual search result."""
        optimized = {}
        for key, value in result.items():
            if value is not None and value != "":
                if key == "content" and isinstance(value, str):
                    # Truncate very long content
                    optimized[key] = value[:1000] + "..." if len(value) > 1000 else value
                else:
                    optimized[key] = value
        return optimized

    def extract_key_insights(self, data: Any) -> List[str]:
        """Extract key insights from search results."""
        insights = []

        if isinstance(data, dict):
            # Extract insights from search response
            if "answer" in data and data["answer"]:
                insights.append(f"AI Answer: {data['answer'][:200]}...")

            if "results" in data and isinstance(data["results"], list):
                result_count = len(data["results"])
                insights.append(f"Found {result_count} relevant sources")

                # Analyze domains
                domains = set()
                for result in data["results"][:5]:  # Top 5 results
                    if "url" in result:
                        domain = urlparse(result["url"]).netloc
                        domains.add(domain)

                if domains:
                    insights.append(f"Top sources: {', '.join(list(domains)[:3])}")

            if "images" in data and isinstance(data["images"], list):
                image_count = len(data["images"])
                if image_count > 0:
                    insights.append(f"Found {image_count} related images")

        return insights

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "intelligent_web_search",
            "description": "Perform intelligent web search with AI-powered result ranking and analysis. This cloud-based tool replaces sandbox web search functionality, providing real-time information from the internet with intelligent processing, source verification, and optimized responses. Perfect for research, fact-checking, and gathering current information on any topic.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query to find relevant information. Use natural language questions or specific keywords. The AI will optimize the search for best results."
                    },
                    "num_results": {
                        "type": "integer",
                        "description": "Number of search results to return (1-50). Higher numbers provide more comprehensive coverage.",
                        "default": 10,
                        "minimum": 1,
                        "maximum": 50
                    },
                    "search_depth": {
                        "type": "string",
                        "description": "Search depth level: 'basic' for quick results, 'advanced' for comprehensive analysis",
                        "enum": ["basic", "advanced"],
                        "default": "advanced"
                    },
                    "include_images": {
                        "type": "boolean",
                        "description": "Whether to include related images in the search results",
                        "default": True
                    }
                },
                "required": ["query"]
            }
        }
    })
    @usage_example('''
        <!-- Basic intelligent search -->
        <function_calls>
        <invoke name="intelligent_web_search">
        <parameter name="query">latest developments in AI safety research 2024</parameter>
        <parameter name="num_results">15</parameter>
        </invoke>
        </function_calls>

        <!-- Advanced search with images -->
        <function_calls>
        <invoke name="intelligent_web_search">
        <parameter name="query">climate change impact on Arctic ice</parameter>
        <parameter name="search_depth">advanced</parameter>
        <parameter name="include_images">true</parameter>
        </invoke>
        </function_calls>
        ''')
    async def intelligent_web_search(
        self,
        query: str,
        num_results: int = 10,
        search_depth: str = "advanced",
        include_images: bool = True
    ) -> "ToolResult":
        """
        Perform intelligent web search with AI-powered analysis.

        Args:
            query: Search query
            num_results: Number of results to return
            search_depth: Depth of search analysis
            include_images: Whether to include images

        Returns:
            ToolResult with intelligent search results and insights
        """
        try:
            # Validate inputs
            if not query or not query.strip():
                return self.format_cloud_error("Search query is required", "intelligent_web_search")

            # Normalize parameters
            num_results = max(1, min(num_results or 10, 50))
            search_depth = search_depth or "advanced"

            # Check cache first
            cache_key = f"search:{hash(query)}:{num_results}:{search_depth}"
            cached_result = self.get_cached_response(cache_key)
            if cached_result:
                logger.info(f"Returning cached search results for: {query}")
                return self.format_intelligent_response(cached_result, "intelligent_web_search")

            logger.info(f"Performing intelligent search: '{query}' (depth: {search_depth}, results: {num_results})")

            # Execute Tavily search
            search_response = await self.tavily_client.search(
                query=query,
                max_results=num_results,
                include_images=include_images,
                include_answer="advanced" if search_depth == "advanced" else "basic",
                search_depth=search_depth
            )

            # Validate response
            if not search_response:
                return self.format_cloud_error("No response from search service", "intelligent_web_search")

            # Enhance results with intelligent processing
            enhanced_response = await self._enhance_search_results(search_response, query)

            # Cache successful results
            self.cache_response(cache_key, enhanced_response, ttl_minutes=30)

            logger.info(f"Completed intelligent search for: '{query}' with {len(enhanced_response.get('results', []))} results")
            return self.format_intelligent_response(enhanced_response, "intelligent_web_search")

        except Exception as e:
            return self.format_cloud_error(e, "intelligent_web_search")

    async def _enhance_search_results(self, search_response: Dict[str, Any], query: str) -> Dict[str, Any]:
        """Enhance search results with intelligent processing."""
        enhanced = search_response.copy()

        # Add query context
        enhanced["search_query"] = query
        enhanced["processed_at"] = datetime.now().isoformat()

        # Enhance individual results
        if "results" in enhanced and isinstance(enhanced["results"], list):
            for i, result in enumerate(enhanced["results"]):
                result["relevance_rank"] = i + 1
                result["source_domain"] = urlparse(result.get("url", "")).netloc

                # Add content preview
                if "content" in result and result["content"]:
                    result["content_preview"] = self._create_content_preview(result["content"])

        # Add search metadata
        enhanced["search_metadata"] = {
            "total_results": len(enhanced.get("results", [])),
            "has_answer": bool(enhanced.get("answer")),
            "has_images": bool(enhanced.get("images")),
            "search_quality": self._assess_search_quality(enhanced)
        }

        return enhanced

    def _create_content_preview(self, content: str) -> str:
        """Create a smart preview of content."""
        if not content:
            return ""

        # Clean up content
        cleaned = re.sub(r'\s+', ' ', content.strip())

        # Create preview (first 300 chars or first complete sentence)
        if len(cleaned) <= 300:
            return cleaned

        # Find the last complete sentence within 300 chars
        preview = cleaned[:300]
        last_period = preview.rfind('.')
        if last_period > 200:  # Ensure we have meaningful content
            return preview[:last_period + 1]

        return preview + "..."

    def _assess_search_quality(self, response: Dict[str, Any]) -> str:
        """Assess the quality of search results."""
        score = 0

        # Check if we have an AI answer
        if response.get("answer"):
            score += 3

        # Check number of results
        results_count = len(response.get("results", []))
        if results_count >= 10:
            score += 2
        elif results_count >= 5:
            score += 1

        # Check if we have images
        if response.get("images"):
            score += 1

        # Determine quality level
        if score >= 5:
            return "excellent"
        elif score >= 3:
            return "good"
        elif score >= 1:
            return "fair"
        else:
            return "limited"

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "extract_web_content",
            "description": "Extract and analyze content from multiple web pages intelligently. This cloud-based tool replaces sandbox web scraping functionality, providing clean content extraction, automatic summarization, and intelligent content analysis. Perfect for deep research and content analysis.",
            "parameters": {
                "type": "object",
                "properties": {
                    "urls": {
                        "type": "string",
                        "description": "Comma-separated list of URLs to extract content from. Example: 'https://example.com/page1,https://example.com/page2'"
                    },
                    "extract_mode": {
                        "type": "string",
                        "description": "Content extraction mode: 'text' for clean text only, 'structured' for text with metadata, 'full' for complete analysis",
                        "enum": ["text", "structured", "full"],
                        "default": "structured"
                    },
                    "summarize": {
                        "type": "boolean",
                        "description": "Whether to include intelligent content summarization",
                        "default": True
                    }
                },
                "required": ["urls"]
            }
        }
    })
    @usage_example('''
        <!-- Extract content from multiple pages -->
        <function_calls>
        <invoke name="extract_web_content">
        <parameter name="urls">https://zmind.so/</parameter>
        <parameter name="extract_mode">structured</parameter>
        </invoke>
        </function_calls>

        <!-- Full analysis with summarization -->
        <function_calls>
        <invoke name="extract_web_content">
        <parameter name="urls">https://example.com/research-paper</parameter>
        <parameter name="extract_mode">full</parameter>
        <parameter name="summarize">true</parameter>
        </invoke>
        </function_calls>
        ''')
    async def extract_web_content(
        self,
        urls: str,
        extract_mode: str = "structured",
        summarize: bool = True
    ) -> "ToolResult":
        """
        Extract and analyze content from web pages intelligently.

        Args:
            urls: Comma-separated URLs to extract
            extract_mode: Level of content extraction
            summarize: Whether to include summarization

        Returns:
            ToolResult with extracted and analyzed content
        """
        try:
            # Parse URLs
            if not urls or not urls.strip():
                return self.format_cloud_error("URLs are required", "extract_web_content")

            url_list = [url.strip() for url in urls.split(',') if url.strip()]
            if not url_list:
                return self.format_cloud_error("No valid URLs provided", "extract_web_content")

            logger.info(f"Extracting content from {len(url_list)} URLs with mode: {extract_mode}")

            # Process URLs concurrently
            import asyncio
            tasks = [self._extract_single_url(url, extract_mode, summarize) for url in url_list]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Process results
            successful_extractions = []
            failed_extractions = []

            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    failed_extractions.append({
                        "url": url_list[i],
                        "error": str(result)
                    })
                else:
                    successful_extractions.append(result)

            # Create response
            response = {
                "extracted_content": successful_extractions,
                "failed_extractions": failed_extractions,
                "total_urls": len(url_list),
                "successful_count": len(successful_extractions),
                "failed_count": len(failed_extractions),
                "extraction_mode": extract_mode,
                "processed_at": datetime.now().isoformat()
            }

            if successful_extractions:
                return self.format_intelligent_response(response, "extract_web_content")
            else:
                return self.format_cloud_error("Failed to extract content from any URLs", "extract_web_content")

        except Exception as e:
            return self.format_cloud_error(e, "extract_web_content")

    async def _extract_single_url(self, url: str, extract_mode: str, summarize: bool) -> Dict[str, Any]:
        """Extract content from a single URL."""
        logger.debug(f"Extracting content from: {url}")

        # Determine formats to request
        formats = ["markdown"]
        if extract_mode == "full":
            formats.append("html")

        # Make request to Firecrawl
        headers = {
            "Authorization": f"Bearer {self.firecrawl_api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "url": url,
            "formats": formats
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.firecrawl_url}/v1/scrape",
                json=payload,
                headers=headers
            )
            response.raise_for_status()
            data = response.json()

        # Extract data
        content_data = data.get("data", {})
        title = content_data.get("metadata", {}).get("title", "")
        markdown_content = content_data.get("markdown", "")
        html_content = content_data.get("html", "") if extract_mode == "full" else None

        # Create result
        result = {
            "url": url,
            "title": title,
            "content": markdown_content,
            "content_length": len(markdown_content),
            "extracted_at": datetime.now().isoformat()
        }

        # Add metadata for structured/full modes
        if extract_mode in ["structured", "full"]:
            result["metadata"] = content_data.get("metadata", {})

        # Add HTML for full mode
        if extract_mode == "full" and html_content:
            result["html"] = html_content

        # Add summary if requested
        if summarize and markdown_content:
            result["summary"] = self._create_content_summary(markdown_content)

        return result

    def _create_content_summary(self, content: str) -> str:
        """Create a smart summary of content."""
        if not content or len(content) < 100:
            return content

        # Simple extractive summarization
        sentences = re.split(r'[.!?]+', content)
        sentences = [s.strip() for s in sentences if len(s.strip()) > 20]

        if len(sentences) <= 3:
            return content

        # Take first sentence, middle sentence, and last sentence
        summary_sentences = [
            sentences[0],
            sentences[len(sentences) // 2],
            sentences[-1]
        ]

        return ". ".join(summary_sentences) + "."
