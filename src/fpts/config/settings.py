from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Global configuration object for the application.
    Values can come from environment variables or a .env file.
    """

    app_name: str = "Forest Phenology Tracking System"
    environment: str = "development"
    log_level: str = "info"
    data_dir: str = "data"
    phenology_repo_backend: Literal["memory", "postgis"] = "postgis"
    enable_debug_routes: bool = False
    enable_metrics: bool = False
    # Largest number of points /phenology/grid returns; larger requests must narrow the bbox.
    grid_max_features: int = 50_000

    # Ingestion for Platery Computer STAC
    pc_stac_url: str = "https://planetarycomputer.microsoft.com/api/stac/v1"
    mod13q1_collection: str = "modis-13Q1-061"
    mod13q1_ndvi_asset_key: str = "250m_16_days_NDVI"

    # Database
    database_dsn: str = "postgresql://postgres:postgres@localhost:5432/fpts"

    # Cache - Redis
    cache_backend: Literal["memory", "redis"] = "memory"
    redis_url: str = "redis://localhost:6379/0"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")
