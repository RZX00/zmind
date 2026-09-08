"""
Cloud-based file upload tool that replaces the sandbox upload functionality.
This tool uploads files directly to R2 (S3-compatible) storage without requiring a sandbox environment.
"""

import os
from pathlib import Path
from typing import Optional
from core.tools.base import ToolResult, openapi_schema, usage_example
from core.tools.base import Tool
from core.services.r2_storage import get_r2_client, get_r2_bucket, create_presigned_get_url
from core.utils.logger import logger
from datetime import datetime
import uuid


class UploadFileTool(Tool):
    """Cloud-based file upload tool for uploading files to R2 storage."""

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "upload_file",
            "description": "Upload a file from local filesystem to secure cloud storage (R2). Returns a secure signed URL that expires after 24 hours for access control and security. Use this to permanently store and share files like screenshots, documents, or generated content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the file to upload. Can be absolute or relative path."
                    },
                    "bucket_name": {
                        "type": "string",
                        "description": "Storage bucket name. Options: 'browser-screenshots' (for screenshots), 'agent-files' (for general files), 'presentations' (for presentation files)",
                        "enum": ["browser-screenshots", "agent-files", "presentations"],
                        "default": "agent-files"
                    },
                    "custom_filename": {
                        "type": "string",
                        "description": "Optional custom filename. If not provided, uses original filename with timestamp."
                    },
                    "make_public": {
                        "type": "boolean",
                    "description": "Whether to issue a longer-lived signed URL. Default: false (short-lived signed URL)",
                        "default": False
                    }
                },
                "required": ["file_path"]
            }
        }
    })
    @usage_example({
        "file_path": "/tmp/screenshot.png",
        "bucket_name": "browser-screenshots",
        "make_public": False
    })
    async def upload_file(
        self,
        file_path: str,
        bucket_name: str = "agent-files",
        custom_filename: Optional[str] = None,
        make_public: bool = False
    ) -> ToolResult:
        """
        Upload a file to Supabase storage.

        Args:
            file_path: Local path to the file to upload
            bucket_name: Target storage bucket
            custom_filename: Optional custom filename
            make_public: Whether to make file publicly accessible

        Returns:
            ToolResult with upload details and access URL
        """
        try:
            # Validate file exists
            if not os.path.exists(file_path):
                return self.fail_response(f"File not found: {file_path}")

            # Read file content
            with open(file_path, 'rb') as f:
                file_content = f.read()

            if len(file_content) == 0:
                return self.fail_response("File is empty; cannot upload empty file")

            # Generate filename
            original_filename = Path(file_path).name
            if custom_filename:
                filename = custom_filename
            else:
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                unique_id = str(uuid.uuid4())[:8]
                file_stem = Path(original_filename).stem
                file_suffix = Path(original_filename).suffix
                filename = f"{file_stem}_{timestamp}_{unique_id}{file_suffix}"

            # Determine content type
            content_type = self._get_content_type(file_path)

            # Upload to R2 storage
            logger.debug(f"Uploading file {filename} to R2 prefix {bucket_name}")
            key = f"{bucket_name}/{filename}"
            r2 = get_r2_client()
            bucket = get_r2_bucket()
            r2.put_object(
                Bucket=bucket,
                Key=key,
                Body=file_content,
                ContentType=content_type,
            )

            # Get access URL (signed)
            ttl_seconds = 60 * 60 * 24
            if make_public:
                ttl_seconds = 60 * 60 * 24 * 7
            access_url = create_presigned_get_url(
                key=key,
                expires_in=ttl_seconds,
                download_filename=filename,
            )
            url_type = "signed"
            expires_info = "7 days" if make_public else "24 hours"

            # Calculate file size for display
            file_size_mb = len(file_content) / (1024 * 1024)

            result_info = {
                'uploaded_file': filename,
                'original_file': original_filename,
                'bucket': bucket_name,
                'size_mb': round(file_size_mb, 2),
                'content_type': content_type,
                'access_url': access_url,
                'url_type': url_type,
                'expires': expires_info,
                'uploaded_from': 'cloud_service',
                'upload_time': datetime.now().isoformat()
            }

            success_message = f"""File uploaded successfully!

📁 **File Details:**
   • Original: {original_filename}
   • Uploaded as: {filename}
   • Size: {file_size_mb:.2f} MB
   • Type: {content_type}

🔗 **Access Information:**
   • URL Type: {url_type.title()}
   • Expires: {expires_info}
   • Storage: {bucket_name}

🌐 **Access URL:** {access_url}

The file is now securely stored and accessible via the provided URL."""

            logger.info(f"Successfully uploaded {original_filename} as {filename} to {bucket_name}")

            return self.success_response({
                "message": success_message,
                "details": result_info
            })

        except FileNotFoundError:
            return self.fail_response(f"File not found: {file_path}")
        except PermissionError:
            return self.fail_response(f"Permission denied accessing file: {file_path}")
        except Exception as e:
            logger.error(f"Error uploading file {file_path}: {str(e)}")
            return self.fail_response(f"Upload failed: {str(e)}")

    def _get_content_type(self, file_path: str) -> str:
        """Determine content type based on file extension."""
        extension = Path(file_path).suffix.lower()

        content_types = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf',
            '.txt': 'text/plain',
            '.md': 'text/markdown',
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.xml': 'application/xml',
            '.csv': 'text/csv',
            '.zip': 'application/zip',
            '.tar': 'application/x-tar',
            '.gz': 'application/gzip',
            '.mp4': 'video/mp4',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        }

        return content_types.get(extension, 'application/octet-stream')
