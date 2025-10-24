from pathlib import Path
from typing import Dict, Optional
import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from logger import housing_logger
from dotenv import load_dotenv

working_dir = Path(__file__).parent.parent.parent
config_path = working_dir / "src" / "config" / "config.yml"
env_path = working_dir / ".env"


def load_environment():
    """Load environment variables from .env file if it exists."""
    if env_path.exists():
        housing_logger.debug(f"Loading environment variables from {env_path}")
        load_dotenv(dotenv_path=env_path)


def load_yaml_config():
    """Load YAML configuration file."""
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


# Load environment and config
load_environment()
yaml_data = load_yaml_config()


class AgencyApiUrls(BaseModel):
    homepage: str
    all_estate_info: str
    single_estate_info: str
    estate_monthly_market_info: str
    building_transactions: str


class WikiApiUrls(BaseModel):
    # page_doc: str
    # summary: str
    search: str


class AgencyApiConfig(BaseModel):
    urls: AgencyApiUrls
    headers: Dict[str, str]

    # Load cookies from env file
    cookies_token: Optional[str] = Field(None, env="AGENCY_API_COOKIES_TOKEN")


class WikiApiConfig(BaseModel):
    urls: WikiApiUrls


class CloudStorageConfig(BaseModel):
    service_type: str = "cloudflare"

class CloudflareConfig(BaseModel):
    endpoint_url: str
    bucket_name: str
    region: str = "auto"

class AWSConfig(BaseModel):
    bucket_name: str
    region: str = "us-east-1"


class CloudStorageSecrets(BaseSettings):
    account_id: Optional[str] = Field(None, alias="cloudflare_account_id")  # Only needed for Cloudflare
    access_key_id: str = Field(alias="cloud_storage_access_key_id")
    secret_access_key: str = Field(alias="cloud_storage_secret_access_key")

    model_config = SettingsConfigDict(
        env_file=env_path if env_path.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )


class BaseStorageConfig(BaseModel):
    path: str
    files: Dict[str, str]


class RAGStorageConfig(BaseModel):
    path: str
    files: Dict[str, str]
    settings: Dict[str, int]


class StorageConfig(BaseModel):
    root_path: str
    agency: BaseStorageConfig
    wiki: BaseStorageConfig
    rag: RAGStorageConfig


class Settings(BaseSettings):
    agency_api: AgencyApiConfig
    wiki_api: WikiApiConfig
    storage: StorageConfig
    cloud_storage: CloudStorageConfig
    cloudflare: CloudflareConfig
    aws: AWSConfig

    model_config = SettingsConfigDict(
        extra="allow",
        env_file=env_path if env_path.exists() else None,
        env_file_encoding="utf-8",
    )
    housing_logger.info("Housing DataHub Configuration Loaded Successfully")


# Create separate settings instances
housing_datahub_config = Settings(**yaml_data)
cloud_storage_secrets = CloudStorageSecrets()
