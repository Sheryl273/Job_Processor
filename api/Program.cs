using System.Text.Json.Serialization;
using Api;
using Api.Data;
using Api.Endpoints;
using Api.Services;
using Api.Workers;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// ── URLs ──────────────────────────────────────────────────────────────────────
builder.WebHost.UseUrls("http://localhost:5080");

// ── Configuration ─────────────────────────────────────────────────────────────
builder.Services.Configure<ProcessingOptions>(builder.Configuration.GetSection(ProcessingOptions.Section));
builder.Services.Configure<CircuitOptions>(builder.Configuration.GetSection(CircuitOptions.Section));

// ── EF Core (SQLite, factory pattern) ────────────────────────────────────────
var connStr = builder.Configuration.GetConnectionString("Default")
    ?? "Data Source=jobs.db;Default Timeout=30";
builder.Services.AddDbContextFactory<AppDbContext>(o =>
    o.UseSqlite(connStr));

// ── JSON: camelCase + enums as strings ────────────────────────────────────────
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});

// ── Singleton services ────────────────────────────────────────────────────────
builder.Services.AddSingleton<FaultInjector>();
builder.Services.AddSingleton<WorkerRegistry>();
builder.Services.AddSingleton<CircuitBreakerManager>();
builder.Services.AddSingleton<JobClaimer>();
builder.Services.AddSingleton<HandlerRegistry>();
builder.Services.AddSingleton<JobRunner>();

// ── Job handlers (singletons, injected into HandlerRegistry) ─────────────────
builder.Services.AddSingleton<IJobHandler, PaymentHandler>();
builder.Services.AddSingleton<IJobHandler, EmailHandler>();
builder.Services.AddSingleton<IJobHandler, ReportHandler>();
builder.Services.AddSingleton<IJobHandler, FlakyHandler>();
builder.Services.AddSingleton<IJobHandler, AlwaysFailHandler>();

// ── Background workers ────────────────────────────────────────────────────────
builder.Services.AddHostedService<WorkerPool>();
builder.Services.AddHostedService<LeaseReaper>();
builder.Services.AddHostedService<CircuitMonitor>();

var app = builder.Build();

// ── DB init (EnsureCreated + WAL mode, NO migrations) ────────────────────────
await using (var scope = app.Services.CreateAsyncScope())
{
    var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<AppDbContext>>();
    await using var db = await factory.CreateDbContextAsync();
    await db.Database.EnsureCreatedAsync();
    await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;");

    var circuitBreaker = scope.ServiceProvider.GetRequiredService<CircuitBreakerManager>();
    await circuitBreaker.InitializeAsync();
}

// ── Endpoints ─────────────────────────────────────────────────────────────────
app.MapJobEndpoints();
app.MapSimEndpoints();

app.Run();
