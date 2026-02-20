// Figma asset URLs
const imgFrame5 =
  "https://www.figma.com/api/mcp/asset/527b4b1c-1b31-4962-affc-2c501def8d30";
const imgFrame6 =
  "https://www.figma.com/api/mcp/asset/4b520583-c7ba-4636-b384-1401e793e629";
const imgFrame7 =
  "https://www.figma.com/api/mcp/asset/56549334-809d-4482-8da6-fe0b71410e0e";
const imgEllipse3 =
  "https://www.figma.com/api/mcp/asset/164cc6b5-7758-42ab-bb5f-b2f162eafb73";
const imgGemini1 =
  "https://www.figma.com/api/mcp/asset/3f067ade-e419-4b15-a904-70085c2071ba";
const imgFrame8 =
  "https://www.figma.com/api/mcp/asset/8862bc3f-ac82-4939-9cd6-99a1e9e1a7cd";
const imgFrame9 =
  "https://www.figma.com/api/mcp/asset/58bcba71-f3ca-4818-b5e7-5f047324d750";

export default function CodeHome() {
  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-10 w-full shrink-0 items-center gap-3 border-[#f1f1f2] border-b px-4">
        <div className="flex min-h-0 min-w-0 flex-1 items-center gap-3">
          <p className="shrink-0 font-sans text-black text-sm leading-normal">
            Harden the SDK error payload
          </p>
          <div className="flex shrink-0 items-center justify-center gap-2">
            <img alt="" className="size-3 shrink-0" src={imgFrame5} />
            <p className="shrink-0 font-sans text-[#808080] text-sm leading-[1.2]">
              feat/sdk-mcp
            </p>
          </div>
        </div>

        {/* PR badge */}
        <div className="flex shrink-0 items-center justify-center gap-1.5 rounded-[6px] bg-[#dfffdf] px-1 py-[3px]">
          <img alt="" className="size-3 shrink-0" src={imgFrame6} />
          <p className="shrink-0 font-sans text-[#54c723] text-xs leading-[1.2]">
            #159
          </p>
        </div>

        {/* Collapse icon */}
        <div className="flex shrink-0 items-center justify-center">
          <div className="flex-none rotate-180">
            <img alt="" className="size-3 shrink-0" src={imgFrame7} />
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-end gap-8 p-4">
        <div className="flex w-full max-w-[750px] flex-col justify-end gap-8">
          {/* User message bubble */}
          <div className="flex w-full shrink-0 items-start overflow-hidden rounded-[16px] bg-[#f6fbff] p-4">
            <p className="min-h-0 min-w-0 flex-1 whitespace-pre-wrap font-sans text-black text-sm leading-[1.3]">
              i wanna forget execution and focus on backend stuff, so highest
              value is making sure errors a logged to database, set as a status
              the healer can pick up, heal, and log the heals (fixed) back to
              the database, right? OR lets focus first on the same flow but
              adding an autofix variant (different to heals, autofixes use the
              commands like biome fix etc, heals use AI)?? what do u think?
            </p>
          </div>

          {/* Agent response */}
          <div className="flex w-full shrink-0 flex-col items-start justify-center gap-6 px-4">
            <div className="flex max-w-[450px] shrink-0 items-start overflow-hidden rounded-[8px]">
              <p className="min-h-0 min-w-0 flex-1 whitespace-pre-wrap font-sans text-black text-sm leading-normal">
                I dont love it, i&apos;d rather you delete everything
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <p
                className="shrink-0 bg-gradient-to-l from-[#e4e4e4] via-[#0080ff] via-[57.212%] to-[#e4e4e4] bg-clip-text font-sans text-xs leading-normal"
                style={{ WebkitTextFillColor: "transparent" }}
              >
                Somelliering
              </p>
              <img alt="" className="size-1 shrink-0" src={imgEllipse3} />
              <p className="shrink-0 font-sans text-[#aaa] text-xs leading-normal">
                22m 13s
              </p>
            </div>
          </div>

          {/* Input box */}
          <div className="flex w-full shrink-0 flex-col items-start justify-center gap-6 overflow-hidden rounded-[4px] border border-[#f0f0f0] bg-white p-2">
            <div className="flex shrink-0 items-center justify-center px-2 py-1">
              <p className="shrink-0 font-sans text-[#aaa] text-sm leading-normal">
                Let&apos;s talk...
              </p>
            </div>
            <div className="flex w-full shrink-0 items-center justify-between">
              <div className="flex shrink-0 items-center gap-2 px-1">
                <img
                  alt=""
                  className="size-3 shrink-0 object-cover"
                  src={imgGemini1}
                />
                <p className="shrink-0 font-sans text-black text-sm leading-normal">
                  Gemini 3 Flash
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <img alt="" className="size-3 shrink-0" src={imgFrame8} />
                <div className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-black">
                  <img alt="" className="size-3 shrink-0" src={imgFrame9} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
