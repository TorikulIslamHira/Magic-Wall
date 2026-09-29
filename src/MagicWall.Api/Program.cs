using System.Text.Json.Serialization;
using MagicWall.Api.Data;
using MagicWall.Api.Hubs;
using MagicWall.Api.Modules.Budget;
using MagicWall.Api.Modules.Election;
using MagicWall.Api.Modules.Geopolitics;
using MagicWall.Api.Modules.Sports;
using MagicWall.Api.Wall;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("MagicWall")));

// Enums go over the wire as names ("Goal", "Football"), not numbers,
// for both REST responses and SignalR messages.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddSignalR()
    .AddJsonProtocol(options =>
        options.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddSingleton<WallStateStore>();

var app = builder.Build();

// Create or upgrade the database on startup, in every environment. Safe because the wall
// runs as a single instance (see WallStateStore), so no two processes migrate at once.
// After changing the model: dotnet ef migrations add <Name> --project src/MagicWall.Api --output-dir Data/Migrations
using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
}

// Serves wwwroot/magic-wall.html, admin-dashboard.html and their js/css/maps/fonts.
// Unknown extensions are never served, so the map files need their type registered.
var contentTypes = new FileExtensionContentTypeProvider();
contentTypes.Mappings[".geojson"] = "application/geo+json";

// no-cache = revalidate every load (cheap 304s on the studio LAN). Without it, browsers
// heuristically cache ES modules and can mix old and new files after an upgrade.
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = contentTypes,
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache"
});
app.MapGet("/", () => Results.Redirect("/magic-wall.html")).ExcludeFromDescription();

app.MapHub<MagicWallHub>(MagicWallHub.Route);

app.MapWallEndpoints();
app.MapElectionEndpoints();
app.MapSportsEndpoints();
app.MapWarEndpoints();
app.MapBudgetEndpoints();

app.Run();
