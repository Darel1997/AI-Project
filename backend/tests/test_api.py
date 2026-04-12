"""
Basic tests for the RepoInsight API.

These verify that core endpoints respond correctly
and that the auth flow works end-to-end.
"""

import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.anyio
async def test_health_check(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["service"] == "repoinsight-api"


@pytest.mark.anyio
async def test_register_and_login(client: AsyncClient):
    # register
    resp = await client.post("/api/auth/register", json={
        "email": "test@example.com",
        "password": "testpassword123",
        "full_name": "Test User",
    })
    # might be 201 (new) or 409 (already exists from prior test run)
    assert resp.status_code in (201, 409)

    if resp.status_code == 201:
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["email"] == "test@example.com"

    # login
    resp = await client.post("/api/auth/login", json={
        "email": "test@example.com",
        "password": "testpassword123",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    token = data["access_token"]

    # get current user
    resp = await client.get("/api/auth/me", headers={
        "Authorization": f"Bearer {token}",
    })
    assert resp.status_code == 200
    assert resp.json()["email"] == "test@example.com"


@pytest.mark.anyio
async def test_repos_requires_auth(client: AsyncClient):
    resp = await client.get("/api/repos/")
    assert resp.status_code == 403  # no auth header


@pytest.mark.anyio
async def test_github_oauth_url(client: AsyncClient):
    resp = await client.get("/api/auth/github/url")
    assert resp.status_code == 200
    assert "url" in resp.json()
