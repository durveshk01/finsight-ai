import asyncio
import math
import time

from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from redis.exceptions import RedisError


_INCREMENT_WITH_TTL = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
"""


class RateLimiter:
    def __init__(self, redis_url: str | None):
        self.redis = (
            Redis.from_url(redis_url, decode_responses=True, socket_connect_timeout=0.5, socket_timeout=0.5)
            if redis_url
            else None
        )
        self._memory: dict[str, tuple[int, int]] = {}
        self._lock = asyncio.Lock()

    def clear_memory(self) -> None:
        self._memory.clear()

    async def consume(self, key: str, limit: int, window_seconds: int = 60) -> tuple[bool, int]:
        now = time.time()
        window = int(now // window_seconds)
        redis_key = f"finsight:rate-limit:{window}:{key}"
        if self.redis is not None:
            try:
                count = int(await self.redis.eval(_INCREMENT_WITH_TTL, 1, redis_key, window_seconds + 2))
            except (RedisError, OSError, TimeoutError):
                self.redis = None
                count = await self._consume_memory(key, window)
        else:
            count = await self._consume_memory(key, window)

        retry_after = max(1, math.ceil((window + 1) * window_seconds - now))
        return count <= limit, retry_after

    async def _consume_memory(self, key: str, window: int) -> int:
        async with self._lock:
            if len(self._memory) > 10_000:
                self._memory = {item: value for item, value in self._memory.items() if value[0] == window}
            old_window, count = self._memory.get(key, (window, 0))
            count = count + 1 if old_window == window else 1
            self._memory[key] = (window, count)
            return count

    async def close(self) -> None:
        if self.redis is not None:
            await self.redis.aclose()


class RateLimitMiddleware:
    def __init__(self, app, limiter: RateLimiter):
        self.app = app
        self.limiter = limiter

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if path == "/api/auth/login":
            limit = 10
        elif path == "/api/auth/register":
            limit = 5
        else:
            limit = 600

        client = scope.get("client")
        client_ip = client[0] if client else "unknown"
        allowed, retry_after = await self.limiter.consume(f"{client_ip}:{path}", limit)
        if not allowed:
            response = JSONResponse(
                {"detail": "Too many requests. Please try again shortly."},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
