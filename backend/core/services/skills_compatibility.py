"""
Skills Compatibility Service for Skills Marketplace.

This service checks compatibility between external Claude Code skills and Zmind platform.
Zmind has different tool capabilities compared to Claude Code CLI, so not all skills
will be fully compatible.

Compatibility Levels:
- compatible: All tools are available in Zmind (60-70% of skills)
- partial: Some tools unavailable, but skill can still work with limitations (20-30%)
- incompatible: Core tools unavailable, skill won't work properly (10-20%)
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

from core.skills.types import SkillDefinition
from core.utils.logger import logger


class SkillsCompatibilityService:
    """Service for checking skill compatibility with Zmind platform."""

    # Claude Code CLI-specific tools that are NOT available in Zmind
    INCOMPATIBLE_TOOLS: Set[str] = {
        # Code editing tools (Zmind uses canvas instead)
        "Bash",
        "Shell",
        "Edit",
        "Write",
        "Read",
        "Glob",
        "Grep",

        # Git operations (Zmind doesn't have direct git access)
        "GitCommit",
        "GitPush",
        "GitPull",
        "GitStatus",
        "GitDiff",

        # LSP and IDE-specific
        "LSP",
        "GoToDefinition",
        "FindReferences",

        # File system operations (different model in Zmind)
        "FileEdit",
        "CreateFile",
        "DeleteFile",
        "MoveFile",
        "CopyFile",

        # CLI-specific
        "AskUserQuestion",
        "EnterPlanMode",
        "ExitPlanMode",
    }

    # Zmind-specific tools that can replace some incompatible tools
    ZMIND_ALTERNATIVES: Dict[str, List[str]] = {
        "Bash": ["web_search_tool"],
        "Shell": ["web_search_tool"],
        "Edit": ["canvas_edit"],
        "Write": ["canvas_edit"],
        "Read": ["canvas_read", "document_service_tool"],
        "GitCommit": [],  # No alternative
        "FileEdit": ["canvas_edit"],
        "CreateFile": ["canvas_edit"],
    }

    @staticmethod
    def _normalize_tool_name(tool: str) -> str:
        """
        Normalize a tool name by stripping parameters.

        Examples:
            "Bash(curl:*)" -> "Bash"
            "Read(/tmp/*)" -> "Read"
            "web_search_tool" -> "web_search_tool"

        Args:
            tool: The tool name (possibly with parameters)

        Returns:
            The normalized tool name without parameters
        """
        # Strip everything after the first opening parenthesis
        if "(" in tool:
            return tool.split("(")[0]
        return tool

    def check_compatibility(
        self, skill: SkillDefinition
    ) -> Dict[str, Any]:
        """
        Check if a skill is compatible with Zmind platform.

        Args:
            skill: The skill definition to check

        Returns:
            Dictionary with:
            - status: 'compatible', 'partial', or 'incompatible'
            - reason: Human-readable explanation
            - details: Detailed compatibility information
                - incompatible_tools: List of tools that won't work
                - alternatives: Suggested Zmind tools to use instead
                - warnings: List of compatibility warnings
        """
        allowed_tools = set(skill.allowed_tools or [])

        # If no tools specified, assume compatible (prompt-only skill)
        if not allowed_tools:
            return {
                "status": "compatible",
                "reason": "Skill doesn't require specific tools",
                "details": {
                    "incompatible_tools": [],
                    "alternatives": {},
                    "warnings": [],
                },
            }

        # Normalize tool names (strip parameters like "Bash(curl:*)" -> "Bash")
        # to correctly match against INCOMPATIBLE_TOOLS
        normalized_tools = {self._normalize_tool_name(tool) for tool in allowed_tools}

        # Find incompatible tools using normalized names
        incompatible_normalized = normalized_tools & self.INCOMPATIBLE_TOOLS

        # Map back to original tool names (with parameters) for display
        incompatible = {
            tool for tool in allowed_tools
            if self._normalize_tool_name(tool) in incompatible_normalized
        }

        # Calculate compatibility ratio
        total_tools = len(allowed_tools)
        incompatible_count = len(incompatible)
        compatible_ratio = (total_tools - incompatible_count) / total_tools if total_tools > 0 else 1.0

        # Generate alternatives and warnings
        alternatives = {}
        warnings = []

        for tool in incompatible:
            normalized_tool = self._normalize_tool_name(tool)
            if normalized_tool in self.ZMIND_ALTERNATIVES:
                alt_tools = self.ZMIND_ALTERNATIVES[normalized_tool]
                if alt_tools:
                    alternatives[tool] = alt_tools
                else:
                    warnings.append(f"Tool '{tool}' has no Zmind alternative")

        # Determine status
        if incompatible_count == 0:
            status = "compatible"
            reason = "All required tools are available in Zmind"
        elif compatible_ratio >= 0.5:
            status = "partial"
            reason = f"{incompatible_count} of {total_tools} tools unavailable, but skill may still work with limitations"
            warnings.append(f"Missing tools: {', '.join(sorted(incompatible))}")
        else:
            status = "incompatible"
            reason = f"{incompatible_count} of {total_tools} core tools unavailable, skill likely won't work properly"
            warnings.append(f"Critical missing tools: {', '.join(sorted(incompatible))}")

        details = {
            "incompatible_tools": sorted(list(incompatible)),
            "alternatives": alternatives,
            "warnings": warnings,
            "compatible_ratio": round(compatible_ratio, 2),
        }

        logger.info(
            "Skill compatibility check completed",
            skill_name=skill.name,
            status=status,
            incompatible_count=incompatible_count,
            total_tools=total_tools,
        )

        return {
            "status": status,
            "reason": reason,
            "details": details,
        }

    def get_compatibility_suggestions(
        self, skill: SkillDefinition
    ) -> List[str]:
        """
        Get human-readable suggestions for improving skill compatibility.

        Args:
            skill: The skill definition

        Returns:
            List of suggestion strings
        """
        compatibility = self.check_compatibility(skill)
        suggestions = []

        if compatibility["status"] == "compatible":
            suggestions.append("✅ This skill is fully compatible with Zmind!")
            return suggestions

        incompatible = compatibility["details"]["incompatible_tools"]
        alternatives = compatibility["details"]["alternatives"]

        if compatibility["status"] == "partial":
            suggestions.append(
                "⚠️ This skill is partially compatible. Some features may not work."
            )

            # Suggest alternatives
            for tool, alt_tools in alternatives.items():
                if alt_tools:
                    suggestions.append(
                        f"💡 Instead of '{tool}', you can use: {', '.join(alt_tools)}"
                    )

            # Warn about tools without alternatives
            no_alt = [t for t in incompatible if not alternatives.get(t)]
            if no_alt:
                suggestions.append(
                    f"⚠️ These tools have no Zmind alternative: {', '.join(no_alt)}"
                )

        elif compatibility["status"] == "incompatible":
            suggestions.append(
                "❌ This skill requires tools that are not available in Zmind."
            )
            suggestions.append(
                f"Missing critical tools: {', '.join(incompatible[:3])}{'...' if len(incompatible) > 3 else ''}"
            )
            suggestions.append(
                "Consider finding a similar skill designed for web-based platforms."
            )

        return suggestions

    def analyze_skill_catalog(
        self, skills: List[SkillDefinition]
    ) -> Dict[str, Any]:
        """
        Analyze compatibility statistics for a catalog of skills.

        Args:
            skills: List of skill definitions

        Returns:
            Statistics dictionary with:
            - total: Total number of skills
            - compatible: Number of compatible skills
            - partial: Number of partially compatible skills
            - incompatible: Number of incompatible skills
            - compatibility_rate: Percentage of compatible + partial skills
        """
        stats = {
            "total": len(skills),
            "compatible": 0,
            "partial": 0,
            "incompatible": 0,
            "unknown": 0,
        }

        for skill in skills:
            result = self.check_compatibility(skill)
            status = result["status"]
            stats[status] = stats.get(status, 0) + 1

        # Calculate compatibility rate
        usable = stats["compatible"] + stats["partial"]
        stats["compatibility_rate"] = (
            round(usable / stats["total"] * 100, 1) if stats["total"] > 0 else 0.0
        )

        logger.info(
            "Skill catalog compatibility analysis",
            total=stats["total"],
            compatible=stats["compatible"],
            partial=stats["partial"],
            incompatible=stats["incompatible"],
            compatibility_rate=stats["compatibility_rate"],
        )

        return stats


# Global service instance
_compatibility_service: Optional[SkillsCompatibilityService] = None


def get_compatibility_service() -> SkillsCompatibilityService:
    """Get global SkillsCompatibilityService instance (singleton)."""
    global _compatibility_service
    if _compatibility_service is None:
        _compatibility_service = SkillsCompatibilityService()
    return _compatibility_service
