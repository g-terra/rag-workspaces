"""Shared fixtures for the component tests.

The components run against Langflow's real framework (lfx). Nothing reaches the network: HTTP is mocked with
respx.
"""

import ipaddress
import socket
import sys

import pytest


@pytest.fixture(autouse=True)
def _fresh_caches():
    """web_page keeps a cache in a module registered in sys.modules, which outlives a test."""
    for name in ("rag_workspaces_web_cache",):
        module = sys.modules.get(name)
        for attr in ("robots",):
            if module is not None and isinstance(getattr(module, attr, None), dict):
                getattr(module, attr).clear()
    yield


@pytest.fixture(autouse=True)
def _no_dns_and_default_guard(monkeypatch):
    """Tests never resolve names, and Langflow's SSRF guard runs as it does by default, whatever the shell has set.

    An IP address resolves to itself (the guard looks up even those); any name fails to resolve.
    """
    for name in ("LANGFLOW_SSRF_ALLOWED_HOSTS", "CRAWL_ALLOWED_HOSTS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LANGFLOW_SSRF_PROTECTION_ENABLED", "true")

    def getaddrinfo(host, port, *args, **kwargs):
        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            raise socket.gaierror(socket.EAI_NONAME, f"tests do not resolve {host}") from None
        family = socket.AF_INET6 if ip.version == 6 else socket.AF_INET
        return [(family, socket.SOCK_STREAM, 6, "", (str(ip), port or 0))]

    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)

