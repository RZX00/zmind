import boto3
from botocore.config import Config as BotoConfig

from core.utils.config import config, EnvMode


def get_r2_bucket() -> str:
    if config.ENV_MODE == EnvMode.PRODUCTION and config.R2_BUCKET_PROD:
        return config.R2_BUCKET_PROD
    if config.R2_BUCKET_DEV:
        return config.R2_BUCKET_DEV
    if config.R2_BUCKET_PROD:
        return config.R2_BUCKET_PROD
    raise RuntimeError("R2 bucket is not configured")


def get_r2_client():
    if not config.R2_ENDPOINT:
        raise RuntimeError("R2_ENDPOINT is not configured")
    if not config.R2_ACCESS_KEY_ID or not config.R2_SECRET_ACCESS_KEY:
        raise RuntimeError("R2 credentials are not configured")

    s3_config = {"addressing_style": "path"} if config.R2_FORCE_PATH_STYLE else None
    return boto3.client(
        "s3",
        endpoint_url=config.R2_ENDPOINT,
        region_name=config.R2_REGION or "auto",
        aws_access_key_id=config.R2_ACCESS_KEY_ID,
        aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
        config=BotoConfig(s3=s3_config) if s3_config else None,
    )


def create_presigned_put_url(key: str, content_type: str, expires_in: int) -> str:
    client = get_r2_client()
    bucket = get_r2_bucket()
    return client.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=expires_in,
    )


def create_presigned_get_url(key: str, expires_in: int, download_filename: str | None = None) -> str:
    client = get_r2_client()
    bucket = get_r2_bucket()
    params = {"Bucket": bucket, "Key": key}
    if download_filename:
        params["ResponseContentDisposition"] = f'attachment; filename="{download_filename}"'
    return client.generate_presigned_url(
        "get_object",
        Params=params,
        ExpiresIn=expires_in,
    )


def head_object(key: str) -> dict:
    client = get_r2_client()
    bucket = get_r2_bucket()
    return client.head_object(Bucket=bucket, Key=key)


def get_object_bytes(key: str) -> bytes:
    client = get_r2_client()
    bucket = get_r2_bucket()
    response = client.get_object(Bucket=bucket, Key=key)
    body = response.get("Body")
    if not body:
        return b""
    return body.read()


def create_multipart_upload(key: str, content_type: str) -> str:
    client = get_r2_client()
    bucket = get_r2_bucket()
    resp = client.create_multipart_upload(
        Bucket=bucket,
        Key=key,
        ContentType=content_type,
    )
    upload_id = resp.get("UploadId")
    if not upload_id:
        raise RuntimeError("Failed to create multipart upload")
    return upload_id


def create_presigned_upload_part_url(
    key: str,
    upload_id: str,
    part_number: int,
    expires_in: int,
) -> str:
    client = get_r2_client()
    bucket = get_r2_bucket()
    return client.generate_presigned_url(
        "upload_part",
        Params={
            "Bucket": bucket,
            "Key": key,
            "UploadId": upload_id,
            "PartNumber": part_number,
        },
        ExpiresIn=expires_in,
    )


def list_multipart_parts(key: str, upload_id: str) -> list[dict]:
    client = get_r2_client()
    bucket = get_r2_bucket()
    parts: list[dict] = []
    kwargs = {"Bucket": bucket, "Key": key, "UploadId": upload_id}
    while True:
        resp = client.list_parts(**kwargs)
        parts.extend(resp.get("Parts") or [])
        if not resp.get("IsTruncated"):
            break
        marker = resp.get("NextPartNumberMarker")
        if not marker:
            break
        kwargs["PartNumberMarker"] = marker
    return parts


def complete_multipart_upload(key: str, upload_id: str, parts: list[dict]) -> None:
    client = get_r2_client()
    bucket = get_r2_bucket()
    client.complete_multipart_upload(
        Bucket=bucket,
        Key=key,
        UploadId=upload_id,
        MultipartUpload={"Parts": parts},
    )


def abort_multipart_upload(key: str, upload_id: str) -> None:
    client = get_r2_client()
    bucket = get_r2_bucket()
    client.abort_multipart_upload(
        Bucket=bucket,
        Key=key,
        UploadId=upload_id,
    )
