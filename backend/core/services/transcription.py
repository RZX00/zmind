import os
import openai
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from core.utils.logger import logger
from core.utils.auth_utils import verify_and_get_user_id_from_jwt

router = APIRouter(tags=["transcription"])

class TranscriptionResponse(BaseModel):
    text: str


ALLOWED_TRANSCRIPTION_TYPES = [
    'audio/mp3', 'audio/mpeg', 'audio/mp4', 'audio/m4a',
    'audio/wav', 'audio/webm', 'audio/mpga', 'audio/ogg',
    'video/mp4', 'video/webm', 'video/quicktime',
]


def _validate_transcription_type(content_type: str) -> None:
    if content_type not in ALLOWED_TRANSCRIPTION_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type}. Supported types: {', '.join(ALLOWED_TRANSCRIPTION_TYPES)}",
        )


async def transcribe_audio_bytes(
    content: bytes,
    filename: str,
    content_type: str,
    user_id: str,
) -> str:
    _validate_transcription_type(content_type)

    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds 25MB limit")

    client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    file_extension = filename.split('.')[-1] if filename and '.' in filename else 'webm'

    with tempfile.NamedTemporaryFile(delete=False, suffix=f'.{file_extension}') as temp_file:
        temp_file.write(content)
        temp_file_path = temp_file.name

    try:
        with open(temp_file_path, 'rb') as f:
            transcription = client.audio.transcriptions.create(
                model="gpt-4o-mini-transcribe",
                file=f,
                response_format="text"
            )
        logger.debug(f"Successfully transcribed audio for user {user_id}")
        return transcription
    finally:
        try:
            os.unlink(temp_file_path)
        except Exception as e:
            logger.warning(f"Failed to delete temporary file {temp_file_path}: {e}")

@router.post("/transcription", response_model=TranscriptionResponse)
async def transcribe_audio(
    audio_file: UploadFile = File(...),
    user_id: str = Depends(verify_and_get_user_id_from_jwt)
):
    """Transcribe audio file to text using OpenAI Whisper."""
    try:
        logger.debug(f"Received audio file: {audio_file.filename}, content_type: {audio_file.content_type}")

        content = await audio_file.read()
        transcription = await transcribe_audio_bytes(
            content=content,
            filename=audio_file.filename or "audio",
            content_type=audio_file.content_type or "audio/webm",
            user_id=user_id,
        )
        return TranscriptionResponse(text=transcription)
        
    except Exception as e:
        logger.error(f"Error transcribing audio for user {user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
