using Jobs.Api.Endpoints;
using Jobs.Api.Worker;
using Jobs.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddJobsInfrastructure(builder.Configuration); // Person A
builder.Services.AddJobProcessing(builder.Configuration);      // Person B

var app = builder.Build();

app.UseCors();
app.UseSwagger();
app.UseSwaggerUI();
app.UseDefaultFiles();   // serves dashboard build from wwwroot (Person D)
app.UseStaticFiles();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapJobEndpoints();                                          // Person C

app.Run();

public partial class Program { }
