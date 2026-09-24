using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

public class Contract : IAccessPolicy
{
    [PolicyParam(Required = true, Description = "vuid of the customer who owns case-001")]
    public string OwnerVuid { get; set; }

    [PolicyParam(Required = true, Description = "Realm role granting temporary agent access")]
    public string AgentRole { get; set; }

    // ValidateData always runs and sees ctx.Data / ctx.RequestId, but never the
    // doken. ValidateExecutor sees the doken but never ctx.Data. We only need
    // to confirm the request is encrypt/decrypt with at least one tag here;
    // the actual identity/role check happens in ValidateExecutor.
    private bool _dataValidated = false;

    public PolicyDecision ValidateData(DataContext ctx)
    {
        bool isEncryption;
        if (ctx.RequestId == "PolicyEnabledEncryption:1") isEncryption = true;
        else if (ctx.RequestId == "PolicyEnabledDecryption:1") isEncryption = false;
        else return PolicyDecision.Deny("This contract handles only encryption/decryption requests");

        ReadOnlyMemory<byte> data = ctx.Data;
        var tagCount = 0;

        if (isEncryption)
        {
            var first = data.GetValue(1);
            for (int i = 2; first.TryGetValue(i, out var tag); i++) tagCount++;
        }
        else
        {
            var first = data.GetValue(0);
            for (int i = 3; first.TryGetValue(i, out var tag); i++) tagCount++;
        }

        if (tagCount == 0) return PolicyDecision.Deny("At least one data tag is required");

        _dataValidated = true;
        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        // Fail closed if ValidateData never ran or rejected the request.
        if (!_dataValidated) return PolicyDecision.Deny("Data validation did not run or was rejected");

        var executor = new DokenDto(ctx.Doken);

        // Compare against the doken's UserId, which is the vuid — never the
        // OIDC subject. A doken carries no "sub" claim at all.
        bool isOwner = executor.UserId == OwnerVuid;

        if (isOwner)
        {
            return Decision.RequireNotExpired(executor);
        }

        // Not the owner: fall through to the realm-role check via the
        // Decision builder's documented 2-arg RequireRole(doken, role) form.
        return Decision
            .RequireNotExpired(executor)
            .RequireRole(executor, AgentRole);
    }
}
