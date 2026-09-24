// Minimal local compile stubs mirroring the documented Ork.Forseti.Sdk shapes,
// used ONLY to catch gross API-shape errors before uploading a contract to
// TideCloak (where a compile failure costs a spent enclave approval).
// These stubs are NOT the real SDK and do not execute real logic — they
// exist purely so `dotnet build` can validate C# syntax and call shapes
// against the contract source.

using System;
using System.Collections.Generic;

namespace Ork.Forseti.Sdk
{
    public interface IAccessPolicy
    {
        PolicyDecision ValidateData(DataContext ctx);
    }

    public class PolicyDecision
    {
        public static PolicyDecision Allow() => new PolicyDecision();
        public static PolicyDecision Deny(string reason) => new PolicyDecision();
    }

    public class PolicyParamAttribute : Attribute
    {
        public bool Required { get; set; }
        public string Description { get; set; }
    }

    public class DataContext
    {
        public string RequestId => "";
        public ReadOnlyMemory<byte> Data => default;
        public object Policy => null;
    }

    public class ExecutorContext
    {
        public byte[] Doken => Array.Empty<byte>();
    }

    public class ApproversContext
    {
        public byte[][] Dokens => Array.Empty<byte[]>();
    }
}

namespace Cryptide.Tools
{
    public static class Extensions
    {
        public static ReadOnlyMemory<byte> GetValue(this ReadOnlyMemory<byte> data, int index) => default;
        public static bool TryGetValue(this ReadOnlyMemory<byte> data, int index, out ReadOnlyMemory<byte> value)
        {
            value = default;
            return false;
        }
    }
}

namespace Ork.Shared.Models.Contracts
{
    public enum ApprovalType { IMPLICIT, EXPLICIT }
    public enum ExecutionType { PRIVATE, PUBLIC }

    public class DokenDto
    {
        public DokenDto(byte[] doken) { }
        public string UserId => "";
        public string Audience => "";
        public long Expiry => 0;
        public bool IsExpired => false;
        public bool IsNull => false;
        public bool HasRole(string resource, string role) => false;
        public bool HasAnyRole(string resource, params string[] roles) => false;

        public static List<DokenDto> WrapAll(byte[][] dokens) => new List<DokenDto>();
    }

    public class Decision
    {
        public static Decision RequireNotExpired(DokenDto d) => new Decision();
        public Decision RequireRole(DokenDto d, string role) => this;
        public Decision RequireRole(DokenDto d, string resource, string role) => this;
        public Decision Require(bool condition, string reason) => this;

        public static implicit operator Ork.Forseti.Sdk.PolicyDecision(Decision d) =>
            Ork.Forseti.Sdk.PolicyDecision.Allow();
    }
}
