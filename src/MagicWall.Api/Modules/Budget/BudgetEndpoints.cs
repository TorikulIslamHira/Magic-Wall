using MagicWall.Api.Auth;
using MagicWall.Api.Data;
using MagicWall.Api.Hubs;
using MagicWall.Api.Wall;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace MagicWall.Api.Modules.Budget;

public record MegaProjectDto(
    int Id,
    string Name,
    decimal BudgetAmount,
    double CompletionPercentage,
    string GeoLocation);

public record BudgetSectorDto(
    int Id,
    string Name,
    string FiscalYear,
    decimal TotalAllocation,
    decimal MegaProjectsTotal,
    IReadOnlyList<MegaProjectDto> MegaProjects);

public record SaveSectorRequest(string Name, string FiscalYear, decimal TotalAllocation);

public record SaveProjectRequest(
    int BudgetSectorId,
    string Name,
    decimal BudgetAmount,
    double CompletionPercentage,
    string? GeoLocation);

public static class BudgetEndpoints
{
    public static IEndpointRouteBuilder MapBudgetEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/budget").WithTags("Budget");

        // Optional filter: /api/budget/sectors?fiscalYear=2025-26
        group.MapGet("/sectors", GetSectors);
        group.MapGet("/fiscal-years", GetFiscalYears);

        group.MapPost("/sectors", CreateSector).RequireAuthorization(Policies.EditDesk);
        group.MapPut("/sectors/{id:int}", UpdateSector).RequireAuthorization(Policies.EditDesk);
        group.MapPost("/projects", CreateProject).RequireAuthorization(Policies.EditDesk);
        group.MapPut("/projects/{id:int}", UpdateProject).RequireAuthorization(Policies.EditDesk);
        group.MapDelete("/projects/{id:int}", DeleteProject).RequireAuthorization(Policies.EditDesk);

        return app;
    }

    private static async Task<List<BudgetSectorDto>> GetSectors(
        string? fiscalYear, AppDbContext db, CancellationToken ct)
    {
        var query = db.BudgetSectors.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(fiscalYear))
        {
            query = query.Where(s => s.FiscalYear == fiscalYear);
        }

        var sectors = await query
            .OrderByDescending(s => s.TotalAllocation)
            .ThenBy(s => s.Name)
            .Select(s => new
            {
                s.Id,
                s.Name,
                s.FiscalYear,
                s.TotalAllocation,
                MegaProjects = s.MegaProjects
                    .OrderByDescending(p => p.BudgetAmount)
                    .Select(p => new MegaProjectDto(
                        p.Id, p.Name, p.BudgetAmount, p.CompletionPercentage, p.GeoLocation))
                    .ToList()
            })
            .ToListAsync(ct);

        return sectors
            .Select(s => new BudgetSectorDto(
                s.Id,
                s.Name,
                s.FiscalYear,
                s.TotalAllocation,
                s.MegaProjects.Sum(p => p.BudgetAmount),
                s.MegaProjects))
            .ToList();
    }

    /// <summary>Newest first, so the wall defaults to the current budget.</summary>
    private static Task<List<string>> GetFiscalYears(AppDbContext db, CancellationToken ct) =>
        db.BudgetSectors
            .AsNoTracking()
            .Select(s => s.FiscalYear)
            .Distinct()
            .OrderByDescending(y => y)
            .ToListAsync(ct);

    private static async Task<Results<Created<BudgetSectorDto>, Conflict<string>, ValidationProblem>> CreateSector(
        SaveSectorRequest request, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var (name, fiscalYear, errors) = ValidateSector(request);
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        if (await db.BudgetSectors.AnyAsync(s => s.FiscalYear == fiscalYear && s.Name == name, ct))
        {
            return TypedResults.Conflict($"\"{name}\" খাতটি {fiscalYear} অর্থবছরে আগেই আছে।");
        }

        var sector = new BudgetSector { Name = name, FiscalYear = fiscalYear, TotalAllocation = request.TotalAllocation };
        db.BudgetSectors.Add(sector);
        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.Budget, fiscalYear, ct);

        return TypedResults.Created(
            $"/api/budget/sectors/{sector.Id}",
            new BudgetSectorDto(sector.Id, sector.Name, sector.FiscalYear, sector.TotalAllocation, 0, []));
    }

    private static async Task<Results<NoContent, NotFound, Conflict<string>, ValidationProblem>> UpdateSector(
        int id, SaveSectorRequest request, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var (name, fiscalYear, errors) = ValidateSector(request);
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        var sector = await db.BudgetSectors.FindAsync([id], ct);
        if (sector is null) return TypedResults.NotFound();

        if (await db.BudgetSectors.AnyAsync(s => s.Id != id && s.FiscalYear == fiscalYear && s.Name == name, ct))
        {
            return TypedResults.Conflict($"\"{name}\" খাতটি {fiscalYear} অর্থবছরে আগেই আছে।");
        }

        var previousYear = sector.FiscalYear;
        sector.Name = name;
        sector.FiscalYear = fiscalYear;
        sector.TotalAllocation = request.TotalAllocation;
        await db.SaveChangesAsync(ct);

        await hub.BroadcastDataChangedAsync(WallModule.Budget, fiscalYear, ct);
        if (previousYear != fiscalYear) await hub.BroadcastDataChangedAsync(WallModule.Budget, previousYear, ct);

        return TypedResults.NoContent();
    }

    private static async Task<Results<Created<MegaProjectDto>, NotFound<string>, ValidationProblem>> CreateProject(
        SaveProjectRequest request, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var (name, geoLocation, errors) = ValidateProject(request);
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        var fiscalYear = await SectorFiscalYearAsync(db, request.BudgetSectorId, ct);
        if (fiscalYear is null) return TypedResults.NotFound("বাজেট খাতটি পাওয়া যায়নি।");

        var project = new MegaProject
        {
            BudgetSectorId = request.BudgetSectorId,
            Name = name,
            BudgetAmount = request.BudgetAmount,
            CompletionPercentage = request.CompletionPercentage,
            GeoLocation = geoLocation
        };
        db.MegaProjects.Add(project);
        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.Budget, fiscalYear, ct);

        return TypedResults.Created(
            $"/api/budget/projects/{project.Id}",
            new MegaProjectDto(project.Id, project.Name, project.BudgetAmount, project.CompletionPercentage, project.GeoLocation));
    }

    private static async Task<Results<NoContent, NotFound<string>, ValidationProblem>> UpdateProject(
        int id, SaveProjectRequest request, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var (name, geoLocation, errors) = ValidateProject(request);
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        var project = await db.MegaProjects.Include(p => p.BudgetSector).SingleOrDefaultAsync(p => p.Id == id, ct);
        if (project is null) return TypedResults.NotFound("প্রকল্পটি পাওয়া যায়নি।");

        var fiscalYear = await SectorFiscalYearAsync(db, request.BudgetSectorId, ct);
        if (fiscalYear is null) return TypedResults.NotFound("বাজেট খাতটি পাওয়া যায়নি।");

        var previousYear = project.BudgetSector.FiscalYear;
        project.BudgetSectorId = request.BudgetSectorId;
        project.Name = name;
        project.BudgetAmount = request.BudgetAmount;
        project.CompletionPercentage = request.CompletionPercentage;
        project.GeoLocation = geoLocation;
        await db.SaveChangesAsync(ct);

        await hub.BroadcastDataChangedAsync(WallModule.Budget, fiscalYear, ct);
        if (previousYear != fiscalYear) await hub.BroadcastDataChangedAsync(WallModule.Budget, previousYear, ct);

        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound>> DeleteProject(
        int id, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var project = await db.MegaProjects.Include(p => p.BudgetSector).SingleOrDefaultAsync(p => p.Id == id, ct);
        if (project is null) return TypedResults.NotFound();

        db.MegaProjects.Remove(project);
        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.Budget, project.BudgetSector.FiscalYear, ct);

        return TypedResults.NoContent();
    }

    private static Task<string?> SectorFiscalYearAsync(AppDbContext db, int sectorId, CancellationToken ct) =>
        db.BudgetSectors.Where(s => s.Id == sectorId).Select(s => s.FiscalYear).SingleOrDefaultAsync(ct);

    private static (string Name, string FiscalYear, Dictionary<string, string[]> Errors) ValidateSector(SaveSectorRequest r)
    {
        var name = r.Name?.Trim() ?? string.Empty;
        var fiscalYear = r.FiscalYear?.Trim() ?? string.Empty;
        var errors = new Dictionary<string, string[]>();

        if (name.Length is 0 or > 150) errors["name"] = ["খাতের নাম দিন (সর্বোচ্চ ১৫০ অক্ষর)।"];
        if (fiscalYear.Length is 0 or > 20) errors["fiscalYear"] = ["অর্থবছর দিন (সর্বোচ্চ ২০ অক্ষর), যেমন 2025-26।"];
        if (r.TotalAllocation < 0) errors["totalAllocation"] = ["বরাদ্দ ঋণাত্মক হতে পারে না।"];

        return (name, fiscalYear, errors);
    }

    private static (string Name, string GeoLocation, Dictionary<string, string[]> Errors) ValidateProject(SaveProjectRequest r)
    {
        var name = r.Name?.Trim() ?? string.Empty;
        var geoLocation = r.GeoLocation?.Trim() ?? string.Empty;
        var errors = new Dictionary<string, string[]>();

        if (name.Length is 0 or > 200) errors["name"] = ["প্রকল্পের নাম দিন (সর্বোচ্চ ২০০ অক্ষর)।"];
        if (r.BudgetAmount < 0) errors["budgetAmount"] = ["প্রকল্প ব্যয় ঋণাত্মক হতে পারে না।"];
        if (r.CompletionPercentage is < 0 or > 100 || double.IsNaN(r.CompletionPercentage))
            errors["completionPercentage"] = ["অগ্রগতি ০ থেকে ১০০-এর মধ্যে হতে হবে।"];
        if (geoLocation.Length > 100) errors["geoLocation"] = ["অবস্থান সর্বোচ্চ ১০০ অক্ষর হতে পারে।"];

        return (name, geoLocation, errors);
    }
}
