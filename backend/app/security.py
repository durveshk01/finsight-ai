import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_db
from .models import Business, BusinessMember, User

ALGORITHM = "HS256"
SECRET_KEY = os.getenv("JWT_SECRET", "local-development-secret-change-before-deploy")
password_hash = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)


def validate_security_settings() -> None:
    production = os.getenv("APP_ENV", "development").lower() == "production" or os.getenv("RENDER", "").lower() == "true"
    if production and (SECRET_KEY == "local-development-secret-change-before-deploy" or len(SECRET_KEY.encode()) < 32):
        raise RuntimeError("Production requires a private JWT_SECRET of at least 32 bytes")


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(hours=24)
    return jwt.encode({"sub": str(user_id), "exp": expires}, SECRET_KEY, algorithm=ALGORITHM)


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if not credentials:
        raise HTTPException(401, "Sign in to continue")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(401, "Invalid or expired session") from None
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(401, "User not found")
    return user


def current_business(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Business:
    from fastapi import Request

    # Business selection is provided by the header; authorization is always checked against membership.
    return user_business(user, db, None)


def user_business(user: User, db: Session, business_id: int | None) -> Business:
    stmt = select(Business).join(BusinessMember).where(BusinessMember.user_id == user.id)
    if business_id is not None:
        stmt = stmt.where(Business.id == business_id)
    business = db.scalar(stmt.order_by(Business.id).limit(1))
    if not business:
        raise HTTPException(404, "No business workspace found")
    return business
