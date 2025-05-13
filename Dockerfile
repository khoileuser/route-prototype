FROM python:alpine

WORKDIR /route-prototype

COPY . /route-prototype

# Install dependencies
RUN npm ci

# Build the application
RUN npm run build

# Expose the port
EXPOSE 8000

# Start the application
ENTRYPOINT ["fastapi"]
CMD ["run"]