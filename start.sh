docker stop extremerouter
docker rm extremerouter
docker build -t extremerouter .
docker run -d --name extremerouter -p 20128:20128 --env-file .env -v extremerouter-data:/app/data extremerouter