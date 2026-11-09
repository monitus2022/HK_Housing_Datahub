FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Set working directory
WORKDIR /app

# Install system dependencies. requirements.txt includes the core/RAG/cloud
# files, so copy all requirement fragments before resolving them.
COPY requirements*.txt ./
RUN apt-get update && \
    apt-get install -y build-essential libpq-dev && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Command to run the application
CMD ["python", "src/main.py"]