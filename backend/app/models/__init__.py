"""Import every model here so Alembic autogenerate and metadata see them."""

from app.models.user import User

__all__ = ["User"]
