namespace Jobs.Api.Endpoints;

// OWNER: Person C. Implement every route in docs/CONTRACT.md.
public static class JobEndpoints
{
    public static IEndpointRouteBuilder MapJobEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api");
        // TODO(C):
        // POST /api/jobs                       GET /api/jobs?status=&page=&pageSize=
        // GET  /api/jobs/{id}                  GET /api/jobs/stats
        // GET  /api/deadletters                POST /api/deadletters/{id}/requeue
        // POST /api/demo/seed?count=N
        return app;
    }
}
