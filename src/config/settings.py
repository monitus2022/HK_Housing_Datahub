from pathlib import Path
from typing import Dict
import yaml
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

working_dir = Path(__file__).parent.parent.parent
config_path = working_dir / "src" / "config" / "config.yml"

with open(config_path, 'r', encoding='utf-8') as f:
    yaml_data = yaml.safe_load(f)

class AgencyApiConfig(BaseModel):
    urls: Dict[str, str]
    headers: Dict[str, str]

class WikiApiConfig(BaseModel):
    urls: Dict[str, str]

class StorageConfig(BaseModel):
    root_path: str
    agency: Dict[str, str]
    wiki: Dict[str, str]

class Settings(BaseSettings):
    agency_api: AgencyApiConfig
    wiki_api: WikiApiConfig
    storage: StorageConfig

    model_config = SettingsConfigDict(
        extra="allow"
    )

housing_datahub_config = Settings(**yaml_data)