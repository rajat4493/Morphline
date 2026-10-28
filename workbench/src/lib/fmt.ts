/** Fixed-format UTC timestamps: identical on server and client, unambiguous in exports. */
export const dt = (d: Date | null | undefined) => (d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "unknown");
export const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "unknown");
