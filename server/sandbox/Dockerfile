FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# These are the standard workflow runtime dependencies. Add optional provider
# dependencies deliberately and rebuild the image; workflows cannot pip-install.
COPY requirements.txt /tmp/requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/requirements.txt \
    && python -m pip cache purge \
    && rm -f /tmp/requirements.txt

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin runner

WORKDIR /workspace/code
USER 10001:10001
ENTRYPOINT ["python"]
