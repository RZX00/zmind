"""
DataAnalyticsTool - Cloud-based data analysis and visualization tool.

This tool replaces sandbox-based data analysis functionality with cloud-native
data processing, statistical analysis, and visualization generation capabilities.
Uses external APIs for data processing without requiring sandbox environments.

Features:
- Statistical analysis and data processing
- Chart and visualization generation
- Data format conversion and validation
- Intelligent data insights extraction
- Cloud-based computation for scalability
"""

import json
import base64
from typing import Dict, Any, List, Optional, Union
from datetime import datetime
import re

from core.tools.base import openapi_schema, usage_example
from core.tools.cloud_service_tool import IntelligentCloudServiceTool
from core.utils.config import config
from core.utils.logger import logger


class DataAnalyticsTool(IntelligentCloudServiceTool):
    """
    Cloud-based data analytics tool that replaces sandbox data processing functionality.

    Provides statistical analysis, data visualization, and insights generation
    through cloud APIs without requiring sandbox environments.
    """

    def __init__(self):
        super().__init__(
            service_name="DataAnalytics",
            timeout=60.0,  # Longer timeout for data processing
            max_retries=2,
            rate_limit_calls=50  # Conservative rate limit for computation
        )

        # Initialize computation service (placeholder for future cloud service integration)
        self.computation_service_available = True

        logger.info("Initialized DataAnalyticsTool for cloud-based data analysis")

    async def validate_configuration(self) -> bool:
        """Validate that data analysis capabilities are available."""
        return self.computation_service_available

    def get_capabilities(self) -> Dict[str, Any]:
        """Get the capabilities of this data analytics tool."""
        return {
            "statistical_analysis": True,
            "data_visualization": True,
            "format_conversion": True,
            "data_validation": True,
            "insight_extraction": True,
            "cloud_computation": True,
            "sandbox_free": True,
            "supported_formats": ["json", "csv", "xlsx", "txt"],
            "chart_types": ["line", "bar", "pie", "scatter", "histogram", "heatmap"]
        }

    def optimize_response(self, data: Any) -> Any:
        """Optimize analytics response data."""
        if isinstance(data, dict):
            # Remove large intermediate data and keep only results
            optimized = {}
            for key, value in data.items():
                if key in ["raw_data", "intermediate_calculations"]:
                    # Skip large data dumps
                    if isinstance(value, (list, dict)) and len(str(value)) > 5000:
                        optimized[key] = f"[Large dataset with {len(value) if isinstance(value, list) else 'multiple'} items - truncated for display]"
                    else:
                        optimized[key] = value
                else:
                    optimized[key] = value
            return optimized
        return data

    def extract_key_insights(self, data: Any) -> List[str]:
        """Extract key insights from analytics results."""
        insights = []

        if isinstance(data, dict):
            # Extract statistical insights
            if "statistics" in data:
                stats = data["statistics"]
                if isinstance(stats, dict):
                    for key, value in stats.items():
                        if isinstance(value, (int, float)):
                            insights.append(f"{key.replace('_', ' ').title()}: {value:.2f}")

            # Extract trend insights
            if "trends" in data and isinstance(data["trends"], list):
                for trend in data["trends"][:3]:  # Top 3 trends
                    insights.append(f"Trend: {trend}")

            # Extract correlation insights
            if "correlations" in data and isinstance(data["correlations"], list):
                for corr in data["correlations"][:2]:  # Top 2 correlations
                    insights.append(f"Correlation: {corr}")

        return insights

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "analyze_data",
            "description": "Perform comprehensive statistical analysis on provided data. This cloud-based tool replaces sandbox data analysis functionality, providing descriptive statistics, trend analysis, correlation detection, and data insights without requiring sandbox environments.",
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {
                        "type": "string",
                        "description": "Data to analyze in JSON, CSV, or plain text format. Can be numerical data, time series, or structured datasets."
                    },
                    "analysis_type": {
                        "type": "string",
                        "description": "Type of analysis to perform",
                        "enum": ["descriptive", "trends", "correlations", "comprehensive"],
                        "default": "comprehensive"
                    },
                    "data_format": {
                        "type": "string",
                        "description": "Format of the input data",
                        "enum": ["json", "csv", "text", "auto"],
                        "default": "auto"
                    }
                },
                "required": ["data"]
            }
        }
    })
    @usage_example('''
        <!-- Analyze numerical data -->
        <function_calls>
        <invoke name="analyze_data">
        <parameter name="data">[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25]</parameter>
        <parameter name="analysis_type">comprehensive</parameter>
        </invoke>
        </function_calls>

        <!-- Analyze CSV data -->
        <function_calls>
        <invoke name="analyze_data">
        <parameter name="data">date,sales,customers
2024-01-01,1000,50
2024-01-02,1200,60
2024-01-03,1100,55</parameter>
        <parameter name="data_format">csv</parameter>
        <parameter name="analysis_type">trends</parameter>
        </invoke>
        </function_calls>
        ''')
    async def analyze_data(
        self,
        data: str,
        analysis_type: str = "comprehensive",
        data_format: str = "auto"
    ) -> "ToolResult":
        """
        Perform statistical analysis on provided data.

        Args:
            data: Data to analyze
            analysis_type: Type of analysis to perform
            data_format: Format of input data

        Returns:
            ToolResult with comprehensive analysis results
        """
        try:
            if not data or not data.strip():
                return self.format_cloud_error("Data is required for analysis", "analyze_data")

            logger.info(f"Performing {analysis_type} analysis on {data_format} data")

            # Parse data based on format
            parsed_data = await self._parse_data(data, data_format)
            if not parsed_data:
                return self.format_cloud_error("Unable to parse provided data", "analyze_data")

            # Perform analysis based on type
            analysis_results = await self._perform_analysis(parsed_data, analysis_type)

            # Add metadata
            analysis_results.update({
                "analysis_type": analysis_type,
                "data_format": data_format,
                "data_points": len(parsed_data) if isinstance(parsed_data, list) else "multiple",
                "analyzed_at": datetime.now().isoformat()
            })

            return self.format_intelligent_response(analysis_results, "analyze_data")

        except Exception as e:
            return self.format_cloud_error(e, "analyze_data")

    async def _parse_data(self, data: str, data_format: str) -> Optional[Any]:
        """Parse data based on specified format."""
        try:
            if data_format == "json" or (data_format == "auto" and data.strip().startswith(('[', '{'))):
                return json.loads(data)

            elif data_format == "csv" or (data_format == "auto" and ',' in data and '\n' in data):
                lines = data.strip().split('\n')
                if len(lines) < 2:
                    return None

                headers = [h.strip() for h in lines[0].split(',')]
                rows = []
                for line in lines[1:]:
                    values = [v.strip() for v in line.split(',')]
                    row = {}
                    for i, header in enumerate(headers):
                        if i < len(values):
                            # Try to convert to number
                            try:
                                row[header] = float(values[i])
                            except ValueError:
                                row[header] = values[i]
                    rows.append(row)
                return rows

            else:
                # Try to parse as list of numbers
                numbers = []
                for item in re.findall(r'-?\d+\.?\d*', data):
                    try:
                        numbers.append(float(item))
                    except ValueError:
                        continue
                return numbers if numbers else None

        except Exception as e:
            logger.error(f"Error parsing data: {e}")
            return None

    async def _perform_analysis(self, data: Any, analysis_type: str) -> Dict[str, Any]:
        """Perform the specified analysis on parsed data."""
        results = {}

        if isinstance(data, list) and all(isinstance(x, (int, float)) for x in data):
            # Numerical data analysis
            results.update(self._analyze_numerical_data(data, analysis_type))

        elif isinstance(data, list) and all(isinstance(x, dict) for x in data):
            # Structured data analysis
            results.update(self._analyze_structured_data(data, analysis_type))

        else:
            results["error"] = "Unsupported data format for analysis"

        return results

    def _analyze_numerical_data(self, data: List[float], analysis_type: str) -> Dict[str, Any]:
        """Analyze numerical data."""
        results = {}

        if analysis_type in ["descriptive", "comprehensive"]:
            # Descriptive statistics
            n = len(data)
            mean_val = sum(data) / n
            sorted_data = sorted(data)
            median_val = sorted_data[n//2] if n % 2 == 1 else (sorted_data[n//2-1] + sorted_data[n//2]) / 2

            variance = sum((x - mean_val) ** 2 for x in data) / n
            std_dev = variance ** 0.5

            results["statistics"] = {
                "count": n,
                "mean": round(mean_val, 4),
                "median": median_val,
                "min": min(data),
                "max": max(data),
                "range": max(data) - min(data),
                "variance": round(variance, 4),
                "std_deviation": round(std_dev, 4)
            }

        if analysis_type in ["trends", "comprehensive"]:
            # Trend analysis (simple linear trend)
            if len(data) > 1:
                x_vals = list(range(len(data)))
                n = len(data)
                sum_x = sum(x_vals)
                sum_y = sum(data)
                sum_xy = sum(x * y for x, y in zip(x_vals, data))
                sum_x2 = sum(x * x for x in x_vals)

                slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x)
                intercept = (sum_y - slope * sum_x) / n

                trend_direction = "increasing" if slope > 0.1 else "decreasing" if slope < -0.1 else "stable"

                results["trends"] = [
                    f"Overall trend: {trend_direction}",
                    f"Trend strength: {abs(slope):.4f}",
                    f"Linear equation: y = {slope:.4f}x + {intercept:.4f}"
                ]

        if analysis_type in ["correlations", "comprehensive"]:
            # Auto-correlation for time series
            if len(data) > 10:
                lag1_corr = self._calculate_autocorrelation(data, 1)
                results["correlations"] = [
                    f"Lag-1 autocorrelation: {lag1_corr:.4f}"
                ]

        return results

    def _analyze_structured_data(self, data: List[Dict], analysis_type: str) -> Dict[str, Any]:
        """Analyze structured data."""
        results = {}

        if not data:
            return results

        # Get numerical columns
        numerical_cols = []
        sample_row = data[0]
        for key, value in sample_row.items():
            if isinstance(value, (int, float)):
                numerical_cols.append(key)

        if analysis_type in ["descriptive", "comprehensive"]:
            # Descriptive statistics for each numerical column
            col_stats = {}
            for col in numerical_cols:
                values = [row[col] for row in data if col in row and isinstance(row[col], (int, float))]
                if values:
                    col_stats[col] = self._analyze_numerical_data(values, "descriptive")["statistics"]

            if col_stats:
                results["column_statistics"] = col_stats

        if analysis_type in ["correlations", "comprehensive"]:
            # Correlations between numerical columns
            if len(numerical_cols) >= 2:
                correlations = []
                for i in range(len(numerical_cols)):
                    for j in range(i + 1, len(numerical_cols)):
                        col1, col2 = numerical_cols[i], numerical_cols[j]
                        values1 = [row[col1] for row in data if col1 in row and col2 in row]
                        values2 = [row[col2] for row in data if col1 in row and col2 in row]

                        if len(values1) > 1:
                            corr = self._calculate_correlation(values1, values2)
                            correlations.append(f"{col1} vs {col2}: {corr:.4f}")

                if correlations:
                    results["correlations"] = correlations

        return results

    def _calculate_autocorrelation(self, data: List[float], lag: int) -> float:
        """Calculate autocorrelation at given lag."""
        if len(data) <= lag:
            return 0.0

        n = len(data) - lag
        mean_val = sum(data) / len(data)

        numerator = sum((data[i] - mean_val) * (data[i + lag] - mean_val) for i in range(n))
        denominator = sum((x - mean_val) ** 2 for x in data)

        return numerator / denominator if denominator != 0 else 0.0

    def _calculate_correlation(self, x: List[float], y: List[float]) -> float:
        """Calculate Pearson correlation coefficient."""
        if len(x) != len(y) or len(x) < 2:
            return 0.0

        n = len(x)
        mean_x = sum(x) / n
        mean_y = sum(y) / n

        numerator = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(n))
        denom_x = sum((x[i] - mean_x) ** 2 for i in range(n))
        denom_y = sum((y[i] - mean_y) ** 2 for i in range(n))

        denominator = (denom_x * denom_y) ** 0.5

        return numerator / denominator if denominator != 0 else 0.0

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "generate_insights",
            "description": "Generate intelligent insights and recommendations from data analysis results. This tool processes analysis outcomes and provides actionable insights, pattern recognition, and strategic recommendations based on the data.",
            "parameters": {
                "type": "object",
                "properties": {
                    "analysis_results": {
                        "type": "string",
                        "description": "JSON string containing analysis results from analyze_data or raw data"
                    },
                    "insight_type": {
                        "type": "string",
                        "description": "Type of insights to generate",
                        "enum": ["patterns", "anomalies", "recommendations", "comprehensive"],
                        "default": "comprehensive"
                    },
                    "business_context": {
                        "type": "string",
                        "description": "Optional business context to make insights more relevant (e.g., 'sales', 'marketing', 'operations')",
                        "default": "general"
                    }
                },
                "required": ["analysis_results"]
            }
        }
    })
    @usage_example('''
        <!-- Generate comprehensive insights -->
        <function_calls>
        <invoke name="generate_insights">
        <parameter name="analysis_results">{"statistics": {"mean": 15.5, "trend": "increasing"}, "correlations": ["sales vs marketing: 0.85"]}</parameter>
        <parameter name="insight_type">comprehensive</parameter>
        <parameter name="business_context">sales</parameter>
        </invoke>
        </function_calls>
        ''')
    async def generate_insights(
        self,
        analysis_results: str,
        insight_type: str = "comprehensive",
        business_context: str = "general"
    ) -> "ToolResult":
        """
        Generate intelligent insights from analysis results.

        Args:
            analysis_results: JSON string with analysis data
            insight_type: Type of insights to generate
            business_context: Business context for relevant insights

        Returns:
            ToolResult with generated insights and recommendations
        """
        try:
            # Parse analysis results
            try:
                results = json.loads(analysis_results)
            except json.JSONDecodeError:
                return self.format_cloud_error("Invalid JSON in analysis_results", "generate_insights")

            logger.info(f"Generating {insight_type} insights for {business_context} context")

            insights = await self._generate_insights_from_data(results, insight_type, business_context)

            response = {
                "insights": insights,
                "insight_type": insight_type,
                "business_context": business_context,
                "generated_at": datetime.now().isoformat(),
                "confidence_score": self._calculate_insight_confidence(results, insights)
            }

            return self.format_intelligent_response(response, "generate_insights")

        except Exception as e:
            return self.format_cloud_error(e, "generate_insights")

    async def _generate_insights_from_data(self, results: Dict[str, Any],
                                         insight_type: str, context: str) -> List[str]:
        """Generate insights from analysis results."""
        insights = []

        # Pattern insights
        if insight_type in ["patterns", "comprehensive"]:
            insights.extend(self._extract_pattern_insights(results, context))

        # Anomaly insights
        if insight_type in ["anomalies", "comprehensive"]:
            insights.extend(self._extract_anomaly_insights(results, context))

        # Recommendation insights
        if insight_type in ["recommendations", "comprehensive"]:
            insights.extend(self._extract_recommendation_insights(results, context))

        return insights if insights else ["No significant insights detected in the provided data."]

    def _extract_pattern_insights(self, results: Dict[str, Any], context: str) -> List[str]:
        """Extract pattern-based insights."""
        insights = []

        # Statistical patterns
        if "statistics" in results:
            stats = results["statistics"]
            if isinstance(stats, dict):
                if "std_deviation" in stats and "mean" in stats:
                    cv = stats["std_deviation"] / stats["mean"] if stats["mean"] != 0 else 0
                    if cv > 0.5:
                        insights.append(f"High variability detected (CV: {cv:.2f}) - data shows significant fluctuation")
                    elif cv < 0.1:
                        insights.append(f"Low variability detected (CV: {cv:.2f}) - data is highly consistent")

        # Trend patterns
        if "trends" in results and isinstance(results["trends"], list):
            for trend in results["trends"]:
                if "increasing" in trend.lower():
                    context_msg = "growth opportunity" if context in ["sales", "marketing"] else "upward trend"
                    insights.append(f"Positive trend identified - indicates {context_msg}")
                elif "decreasing" in trend.lower():
                    context_msg = "potential concern" if context in ["sales", "marketing"] else "downward trend"
                    insights.append(f"Negative trend identified - indicates {context_msg}")

        return insights

    def _extract_anomaly_insights(self, results: Dict[str, Any], context: str) -> List[str]:
        """Extract anomaly-based insights."""
        insights = []

        # Statistical anomalies
        if "statistics" in results:
            stats = results["statistics"]
            if isinstance(stats, dict):
                if "min" in stats and "max" in stats and "mean" in stats:
                    range_val = stats["max"] - stats["min"]
                    if range_val > 10 * stats.get("std_deviation", 0):
                        insights.append("Extreme outliers detected - investigate data quality or exceptional events")

        return insights

    def _extract_recommendation_insights(self, results: Dict[str, Any], context: str) -> List[str]:
        """Extract recommendation-based insights."""
        insights = []

        # Correlation recommendations
        if "correlations" in results and isinstance(results["correlations"], list):
            for corr in results["correlations"]:
                if "0.7" in corr or "0.8" in corr or "0.9" in corr:
                    if context == "sales":
                        insights.append("Strong correlation found - consider leveraging this relationship for sales forecasting")
                    elif context == "marketing":
                        insights.append("Strong correlation found - potential for targeted marketing strategies")
                    else:
                        insights.append("Strong correlation found - investigate causal relationships")

        # Trend recommendations
        if "trends" in results and isinstance(results["trends"], list):
            for trend in results["trends"]:
                if "stable" in trend.lower():
                    insights.append("Stable trend detected - good foundation for planning and forecasting")

        return insights

    def _calculate_insight_confidence(self, results: Dict[str, Any], insights: List[str]) -> float:
        """Calculate confidence score for generated insights."""
        confidence = 0.5  # Base confidence

        # Increase confidence based on data quality indicators
        if "statistics" in results and isinstance(results["statistics"], dict):
            stats = results["statistics"]
            if "count" in stats and stats["count"] > 30:
                confidence += 0.2  # Good sample size
            if "std_deviation" in stats and "mean" in stats:
                cv = stats["std_deviation"] / stats["mean"] if stats["mean"] != 0 else 1
                if cv < 0.3:  # Low coefficient of variation
                    confidence += 0.1

        # Increase confidence based on number of insights
        if len(insights) > 3:
            confidence += 0.1

        return min(confidence, 1.0)  # Cap at 1.0