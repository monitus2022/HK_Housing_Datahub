import boto3
from pathlib import Path
from config import housing_datahub_config, cloud_storage_secrets
from logger import housing_logger


class CloudUploadOrchestrator:
    """
    Orchestrator for uploading files to S3-compatible object storage (Cloudflare R2, AWS S3, etc.).
    """

    def __init__(self):
        self.s3_client = None
        self.service_type = housing_datahub_config.cloud_storage.service_type

        # Get configuration based on service type
        if self.service_type == 'aws':
            self.bucket_name = housing_datahub_config.aws.bucket_name
            self.region = housing_datahub_config.aws.region
            self.account_id = None
        elif self.service_type == 'cloudflare':
            self.bucket_name = housing_datahub_config.cloudflare.bucket_name
            self.region = housing_datahub_config.cloudflare.region
            self.account_id = cloud_storage_secrets.account_id
        else:
            raise ValueError(f"Unsupported service type: {self.service_type}")

        self.access_key_id = cloud_storage_secrets.access_key_id
        self.secret_access_key = cloud_storage_secrets.secret_access_key

        self._initialize_s3_client()

    def _initialize_s3_client(self):
        """Initialize the S3 client for the configured service."""
        try:
            # Determine endpoint URL and region based on service type
            if self.service_type == 'aws':
                endpoint_url = f"https://s3.{self.region}.amazonaws.com"
                region_name = self.region
                service_name = "AWS S3"
            elif self.service_type == 'cloudflare':
                endpoint_url = housing_datahub_config.cloudflare.endpoint_url.format(account_id=self.account_id)
                region_name = self.region
                service_name = "Cloudflare R2"
            else:
                raise ValueError(f"Unsupported service type: {self.service_type}")

            self.s3_client = boto3.client(
                's3',
                endpoint_url=endpoint_url,
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key,
                region_name=region_name
            )
            housing_logger.info(f"{service_name} S3 client initialized successfully")
        except Exception as e:
            housing_logger.error(f"Failed to initialize {self.service_type} S3 client: {e}")
            raise

    def upload_files_from_data_folder(self):
        """
        Upload all files from the data folder to the configured S3-compatible bucket.
        """
        try:
            service_name = "AWS S3" if self.service_type == 'aws' else "Cloudflare R2"
            housing_logger.info(f"Starting upload of files from data folder to {service_name}")

            data_path = Path(housing_datahub_config.storage.root_path)

            if not data_path.exists():
                housing_logger.warning(f"Data folder {data_path} does not exist")
                return

            # Walk through all files in the data directory
            for file_path in data_path.rglob('*'):
                if file_path.is_file() and file_path.name != '.DS_Store':
                    # Get relative path for S3 key
                    relative_path = file_path.relative_to(data_path.parent)
                    s3_key = str(relative_path)

                    self._upload_file(str(file_path), s3_key)

            service_name = "AWS S3" if self.service_type == 'aws' else "Cloudflare R2"
            housing_logger.info(f"Upload of files from data folder to {service_name} completed successfully")

        except Exception as e:
            housing_logger.error(f"Upload failed: {e}")
            raise

    def _upload_file(self, local_file_path: str, s3_key: str):
        """
        Upload a single file to the configured S3-compatible service.

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