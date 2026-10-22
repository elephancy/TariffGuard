"""HTTP-only API requests without credential forwarding through redirects."""
from urllib.parse import urlsplit
from urllib.request import (
    HTTPDefaultErrorHandler,
    HTTPErrorProcessor,
    HTTPHandler,
    HTTPSHandler,
    OpenerDirector,
    Request,
)


def open_http(request: Request, *, timeout: int):
    parts = urlsplit(request.full_url)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ValueError("API endpoint must use HTTP or HTTPS")
    if parts.username is not None or parts.password is not None or parts.fragment:
        raise ValueError("API endpoint cannot contain user information or a fragment")
    # Build explicitly: no file/FTP/data handlers and no redirect handler. A 3xx
    # response fails instead of forwarding an Authorization header elsewhere.
    opener = OpenerDirector()
    for handler in (HTTPHandler(), HTTPSHandler(), HTTPDefaultErrorHandler(), HTTPErrorProcessor()):
        opener.add_handler(handler)
    return opener.open(request, timeout=timeout)
