FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir flask pyjwt gunicorn psycopg2-binary requests
COPY app.py sync_users.py ./
EXPOSE 8099
CMD ["gunicorn", "-b", "0.0.0.0:8099", "-w", "2", "--timeout", "120", "app:app"]
