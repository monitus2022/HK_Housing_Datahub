import boto3
from pathlib import Path
from config import housing_datahub_config, cloudflare_secrets
from logger import housing_logger


class CloudUploadOrchestrator:
    """
    Orchestrator for uploading files to Cloudflare R2 object storage.
    """

    def __init__(self):
        self.s3_client = None
        self.bucket_name = housing_datahub_config.cloudflare.bucket_name
        self.account_id = cloudflare_secrets.account_id
        self.access_key_id = cloudflare_secrets.access_key_id
        self.secret_access_key = cloudflare_secrets.secret_access_key

        self._initialize_s3_client()

    def _initialize_s3_client(self):
        """Initialize the S3 client for Cloudflare R2."""
        try:
            self.s3_client = boto3.client(
                's3',
                endpoint_url=housing_datahub_config.cloudflare.endpoint_url.format(account_id=self.account_id),
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key,
                region_name='auto'  # Cloudflare R2 uses 'auto' region
            )
            housing_logger.info("Cloudflare R2 S3 client initialized successfully")
        except Exception as e:
            housing_logger.error(f"Failed to initialize Cloudflare R2 S3 client: {e}")
            raise

    def upload_files_from_data_folder(self):
        """
        Upload all files from the data folder to Cloudflare R2 bucket.
        """
        try:
            housing_logger.info("Starting upload of files from data folder to Cloudflare R2")

            data_path = Path(housing_datahub_config.storage.root_path)

            if not data_path.exists():
                housing_logger.warning(f"Data folder {data_path} does not exist")
                return

            # Walk through all files in the data directory
            for file_path in data_path.rglob('*'):
                if file_path.is_file():
                    # Get relative path for S3 key
                    relative_path = file_path.relative_to(data_path.parent)
                    s3_key = str(relative_path)

                    self._upload_file(str(file_path), s3_key)

            housing_logger.info("Upload of files from data folder completed successfully")

        except Exception as e:
            housing_logger.error(f"Upload failed: {e}")
            raise

    def _upload_file(self, local_file_path: str, s3_key: str):
        """
        Upload a single file to Cloudflare R2.

        Args:
            local_file_path: Path to the local file
            s3_key: Key for the file in S3 bucket
        """
        try:
            self.s3_client.upload_file(local_file_path, self.bucket_name, s3_key)
            housing_logger.info(f"Uploaded {local_file_path} to s3://{self.bucket_name}/{s3_key}")
        except Exception as e:
            housing_logger.error(f"Failed to upload {local_file_path}: {e}")
            raise