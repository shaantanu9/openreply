-- Pandoc Lua filter — give long-quote columns 50% of the table width.
--
-- Citation tables in the briefs typically look like:
--   | Source | ID | Score | Quote |
-- Pandoc's default proportional widths leave Quote crammed and Source
-- spread. This filter detects the `Quote` header (case-insensitive),
-- allocates 50% to it, then divides the remaining 50% across the other
-- columns by weight (Source 1.4, ID 1.0, Score 0.7, otherwise 1.0).
--
-- Lifted from docs/demo_pdf/pdf_build/widen-quote.lua (Apr 2026).
-- Bundled with the package so every md→PDF build gets the same
-- citation-table treatment.

local function header_text(cell)
  return pandoc.utils.stringify(cell):lower():gsub("^%s+",""):gsub("%s+$","")
end

function Table(tbl)
  if not tbl.headers or #tbl.headers == 0 then return nil end

  local headers = {}
  for i, cell in ipairs(tbl.headers) do
    headers[i] = header_text(cell)
  end

  local quote_idx
  for i, h in ipairs(headers) do
    if h == "quote" then
      quote_idx = i
      break
    end
  end
  if not quote_idx then return nil end

  local quote_w = 0.50
  local remaining = 1.0 - quote_w

  local weights = {}
  local total_weight = 0
  for i, h in ipairs(headers) do
    local w
    if i == quote_idx then
      w = nil
    elseif h == "score" then
      w = 0.7
    elseif h == "id" then
      w = 1.0
    elseif h == "source" then
      w = 1.4
    else
      w = 1.0
    end
    weights[i] = w
    if w then total_weight = total_weight + w end
  end

  -- Mutate widths in-place (pandoc 2.9: tbl.widths is a List of floats).
  for i = 1, #tbl.widths do
    if i == quote_idx then
      tbl.widths[i] = quote_w
    else
      tbl.widths[i] = (weights[i] / total_weight) * remaining
    end
  end

  return tbl
end
