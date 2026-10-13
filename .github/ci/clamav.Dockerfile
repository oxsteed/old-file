# CI pre-pulls from ECR Public, falling back to Docker Hub (same official image),
# and passes the source that answered; see .github/workflows/ci.yml.
ARG BASE_IMAGE=public.ecr.aws/docker/library/debian:13-slim
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

RUN apt-get update \
  && apt-get install --no-install-recommends -y \
    ca-certificates \
    clamav \
    clamav-daemon \
    netcat-openbsd \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives

RUN sed -i \
    -e '/^Example$/d' \
    -e '/^#\?TCPSocket /d' \
    -e '/^#\?TCPAddr /d' \
    -e '/^#\?Foreground /d' \
    -e '/^#\?User /d' \
    -e '/^#\?LocalSocket /d' \
    -e '/^#\?LocalSocketGroup /d' \
    -e '/^#\?LocalSocketMode /d' \
    /etc/clamav/clamd.conf \
  && printf '%s\n' \
    'TCPSocket 3310' \
    'TCPAddr 0.0.0.0' \
    'Foreground yes' \
    'User clamav' \
    >> /etc/clamav/clamd.conf \
  && sed -i '/^#\?NotifyClamd /d' /etc/clamav/freshclam.conf \
  && mkdir -p /var/log/clamav /var/lib/clamav \
  && chown -R clamav:clamav /var/log/clamav /var/lib/clamav

COPY entrypoint.sh /usr/local/bin/oxsteed-clamav-entrypoint
RUN chmod 0755 /usr/local/bin/oxsteed-clamav-entrypoint

EXPOSE 3310

HEALTHCHECK --interval=15s --timeout=10s --start-period=180s --retries=30 \
  CMD ["sh", "-c", "nc -z 127.0.0.1 3310"]

ENTRYPOINT ["/usr/local/bin/oxsteed-clamav-entrypoint"]
