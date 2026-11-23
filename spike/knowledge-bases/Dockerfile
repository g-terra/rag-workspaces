FROM langflowai/langflow:1.13.3
# The stock image ships without the pgvector extra that the Postgres KB backend needs.
RUN pip install --no-cache-dir "pgvector>=0.4.2"
