FROM python:3.11-slim

WORKDIR /repo

COPY apps/api/requirements.txt apps/api/requirements.txt
RUN pip install --no-cache-dir -r apps/api/requirements.txt "psycopg[binary]>=3.1"

COPY packages packages
COPY parser parser
COPY scoring scoring
COPY recommendation recommendation
COPY memory memory
COPY migration migration
COPY llm llm
COPY apps/api apps/api

EXPOSE 8000
CMD ["uvicorn", "apps.api.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
