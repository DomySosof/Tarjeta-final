
# Constucion de Imagen Docker 


docker build -t presupuesto-sqlite-app .


# crear la Base de Datos

docker run -d -p 5151:3000 --name presupuesto-db-web -v presupuesto-data:/usr/src/app/data presupuesto-sqlite-app


http://localhost:5151/
