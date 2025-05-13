FROM python:alpine

WORKDIR /route-prototype

COPY . /route-prototype

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Expose the port
EXPOSE 8000

# Start the application
ENTRYPOINT ["fastapi"]
CMD ["run"]