import os


class Settings:
    database_url: str = os.environ.get("DATABASE_URL", "sqlite:///./morphline.db")
    cors_origins: list[str] = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
    max_upload_bytes: int = 200 * 1024 * 1024


settings = Settings()
