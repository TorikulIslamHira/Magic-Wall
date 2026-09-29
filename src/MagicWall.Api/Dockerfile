# Build:  docker build -t magicwall src/MagicWall.Api
# Run:    docker run -d --name magicwall -p 8080:8080 -p 8081:8081 -v magicwall-data:/data \
#           -e Admin__ApiKey="<long random secret>" --restart unless-stopped magicwall

# ---- build ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first, in its own layer, so code changes don't re-download packages.
COPY MagicWall.Api.csproj ./
RUN dotnet restore

COPY . ./
RUN dotnet publish -c Release -o /app/publish --no-restore /p:UseAppHost=false

# ---- runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

# SQLite lives on a volume so data survives image rebuilds; the app user must own it.
RUN mkdir -p /data && chown "$APP_UID" /data

COPY --from=build /app/publish .

# Ports come from Ports__Presenter / Ports__Admin (appsettings: 8080 / 8081), not ASPNETCORE_HTTP_PORTS.
# The base image's default ASPNETCORE_HTTP_PORTS=8080 is cleared so Kestrel doesn't warn about overriding it.
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS= \
    ConnectionStrings__MagicWall="Data Source=/data/magicwall.db"

VOLUME /data
# 8080 = presenter (wall, hub, read-only API)   8081 = admin (control room, all writes)
EXPOSE 8080 8081

# Non-root user provided by the .NET base image.
USER $APP_UID

ENTRYPOINT ["dotnet", "MagicWall.Api.dll"]
