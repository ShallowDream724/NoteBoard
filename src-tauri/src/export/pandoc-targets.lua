-- Target adaptation is deliberately after the common semantic AST. Pandoc still
-- owns image/media relationships, math, lists, tables and footnotes. Requires 3.0+.
Template = ''
if not pandoc.zip then error('请使用 Pandoc 3.0 或更新版本导出 Word/LaTeX。') end
local unsupported_color = false

local function xml(value)
  return tostring(value):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'):gsub('"', '&quot;')
end
local function color(value)
  if not value then return nil end
  local hex = value:match('^#(%x%x%x%x%x%x)$')
  if hex then return hex:upper() end
  local short = value:match('^#(%x%x%x)$')
  if short then return short:gsub('.', '%0%0'):upper() end
  local r, g, b = value:match('^rgb%(%s*(%d+)%s*,%s*(%d+)%s*,%s*(%d+)%s*%)$')
  if r and tonumber(r) <= 255 and tonumber(g) <= 255 and tonumber(b) <= 255 then return string.format('%02X%02X%02X', r, g, b) end
  return nil
end
local function raw(format, value) return pandoc.RawInline(format, value) end
local function surround(content, before, after, format)
  local result = pandoc.List { raw(format, before) }
  result:extend(content); result:insert(raw(format, after)); return result
end
local function properties(attr)
  if (attr['nb-color'] and not color(attr['nb-color'])) or (attr['nb-background'] and not color(attr['nb-background'])) then unsupported_color = true end
  return { color = color(attr['nb-color']), background = color(attr['nb-background']),
    align = attr['nb-align'], indent = tonumber(attr['nb-indent']), vertical = attr['nb-vertical'] }
end

-- Match XML tags with an explicit stack so nested tables attach properties to
-- their own cell. Only this writer's comments are removed; authored text stays.
local function decorate_cells(source, styles)
  local stack, tables, edits, next_table_style = {}, {}, {}, nil
  for start, tag, finish in source:gmatch('()(<[^>]+>)()') do
    local table_style = tag:match('^<!%-%-NBExportTable:(NBExport%d+)%-%->$')
    if table_style then next_table_style = table_style; edits[#edits + 1] = { start, finish, '' } end
    if tag:match('^<w:tbl[%s>]') then tables[#tables + 1] = { style = next_table_style }; next_table_style = nil
    elseif tag == '</w:tbl>' then tables[#tables] = nil
    elseif tag:match('^<w:tblStyle%s') and #tables > 0 and tables[#tables].style then
      edits[#edits + 1] = { start, finish, '<w:tblStyle w:val="' .. tables[#tables].style .. '"/>' }
    end
    if tag:match('^<w:tc[%s>]') then
      stack[#stack + 1] = { open = finish }
    elseif #stack > 0 then
      local cell = stack[#stack]
      if tag == '</w:tcPr>' then cell.properties = start end
      if tag:match('^<w:tcPr%s*/>') then cell.empty_properties = { start, finish } end
      local id = tag:match('^<!%-%-NBExportCell:(%d+)%-%->$')
      if id then cell.style = styles[tonumber(id)]; edits[#edits + 1] = { start, finish, '' } end
      if tag == '</w:tc>' then
        if cell.style then
          local p = cell.style
          local addition = (p.background and '<w:shd w:val="clear" w:color="auto" w:fill="' .. p.background .. '"/>' or '')
            .. (p.vertical and '<w:vAlign w:val="' .. (p.vertical == 'middle' and 'center' or p.vertical) .. '"/>' or '')
          local at = cell.properties or (cell.empty_properties and cell.empty_properties[1]) or cell.open
          edits[#edits + 1] = { at, cell.empty_properties and cell.empty_properties[2] or at, cell.properties and addition or '<w:tcPr>' .. addition .. '</w:tcPr>' }
        end
        stack[#stack] = nil
      end
    end
  end
  table.sort(edits, function(a, b) return a[1] < b[1] end)
  local parts, cursor = {}, 1
  for _, edit in ipairs(edits) do parts[#parts + 1] = source:sub(cursor, edit[1] - 1); parts[#parts + 1] = edit[3]; cursor = edit[2] end
  parts[#parts + 1] = source:sub(cursor)
  return table.concat(parts)
end

local function word_document(doc, options)
  local styles, keys, cells, cell_keys = {}, {}, {}, {}
  local function style(kind, p, base)
    local key = kind .. ':' .. (base or '') .. ':' .. (p.color or '') .. ':' .. (p.background or '') .. ':' .. (p.align or '') .. ':' .. tostring(p.indent or '')
    if keys[key] then return keys[key] end
    local name = 'NBExport' .. (#styles + 1)
    keys[key] = name
    local paragraph = (p.align and '<w:jc w:val="' .. xml(p.align) .. '"/>' or '')
      .. (p.indent and '<w:ind w:left="' .. tostring(p.indent * 480) .. '"/>' or '')
    local run = (p.color and '<w:color w:val="' .. p.color .. '"/>' or '')
      .. (p.background and '<w:shd w:val="clear" w:color="auto" w:fill="' .. p.background .. '"/>' or '')
    local body = '<w:name w:val="' .. name .. '"/><w:basedOn w:val="' .. (base or (kind == 'character' and 'DefaultParagraphFont' or 'BodyText')) .. '"/>'
      .. (paragraph ~= '' and '<w:pPr>' .. paragraph .. '</w:pPr>' or '')
      .. (run ~= '' and '<w:rPr>' .. run .. '</w:rPr>' or '')
    styles[#styles + 1] = { name = name, xml = '<w:style w:type="' .. kind .. '" w:customStyle="1" w:styleId="' .. name .. '">' .. body .. '</w:style>' }
    return name
  end
  local function cell(value)
    local p = properties(value.attributes)
    if p.background or p.vertical then
      local key = (p.background or '') .. ':' .. (p.vertical or '')
      local id = cell_keys[key]
      if not id then id = #cells + 1; cells[id] = p; cell_keys[key] = id end
      value.contents:insert(1, pandoc.RawBlock('openxml', '<!--NBExportCell:' .. id .. '-->'))
    end
    return value
  end
  local function table_style(kind)
    local key = 'table:' .. kind
    if keys[key] then return keys[key] end
    local name = 'NBExport' .. (#styles + 1)
    keys[key] = name
    local borders = {}
    for _, edge in ipairs { 'top', 'left', 'bottom', 'right', 'insideH', 'insideV' } do
      local visible = kind == 'grid' or (kind == 'three-line' and (edge == 'top' or edge == 'bottom'))
      borders[#borders + 1] = '<w:' .. edge .. ' w:val="' .. (visible and 'single' or 'nil') .. '" w:sz="4" w:color="auto"/>'
    end
    local header = kind == 'three-line' and '<w:tblStylePr w:type="firstRow"><w:tcPr><w:tcBorders><w:bottom w:val="single" w:sz="4" w:color="auto"/></w:tcBorders></w:tcPr></w:tblStylePr>' or ''
    styles[#styles + 1] = { name = name, xml = '<w:style w:type="table" w:customStyle="1" w:styleId="' .. name .. '"><w:name w:val="' .. name .. '"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>' .. table.concat(borders) .. '</w:tblBorders></w:tblPr>' .. header .. '</w:style>' }
    return name
  end
  doc = doc:walk {
    Span = function(value)
      local p = properties(value.attributes)
      if p.color or p.background then value.attributes['custom-style'] = style('character', p) end
      return value
    end,
    Div = function(value)
      local p = properties(value.attributes)
      if p.align or p.indent then value.attributes['custom-style'] = style('paragraph', p) end
      return value
    end,
    Header = function(value)
      local p = properties(value.attributes)
      if not (p.align or p.indent) then return value end
      return pandoc.Div({ pandoc.Para(value.content) }, pandoc.Attr(value.identifier, {}, { ['custom-style'] = style('paragraph', p, 'Heading' .. value.level) }))
    end,
    Table = function(value)
      local name = table_style(value.attributes['nb-gallery'] and 'gallery' or value.attributes['nb-table-style'] or 'grid')
      value.attributes['custom-style'] = name
      -- Cell is a component, not a walk callback on supported Pandoc versions.
      local function rows(items) for _, row in ipairs(items) do for index, item in ipairs(row.cells) do row.cells[index] = cell(item) end end end
      rows(value.head.rows); rows(value.foot.rows)
      for _, body in ipairs(value.bodies) do rows(body.head); rows(body.body) end
      -- Pandoc 3.2 ignores Table custom-style. The marker also keeps the mapping
      -- exact on that version, including nested tables, without a version guess.
      return { pandoc.RawBlock('openxml', '<!--NBExportTable:' .. name .. '-->'), value }
    end,
  }
  local generated = pandoc.write(doc, 'docx', options)
  local archive, replacements = pandoc.zip.Archive(generated), {}
  for _, value in ipairs(styles) do replacements[value.name] = value.xml end
  local entries = {}
  for _, entry in ipairs(archive.entries) do
    local contents = entry:contents()
    if entry.path == 'word/styles.xml' then
      local found = {}
      contents = contents:gsub('<w:style%s[^>]*>.-</w:style>', function(value)
        local id = value:match('w:styleId="([^"]+)"')
        if replacements[id] then found[id] = true; return replacements[id] end
        return value
      end)
      local missing = {}
      for _, value in ipairs(styles) do if not found[value.name] then missing[#missing + 1] = value.xml end end
      contents = contents:gsub('</w:styles>', table.concat(missing) .. '</w:styles>')
    elseif entry.path:match('^word/.*%.xml$') then contents = decorate_cells(contents, cells) end
    entries[#entries + 1] = pandoc.zip.Entry(entry.path, contents, entry.modtime)
  end
  return pandoc.zip.Archive(entries):bytestring()
end

local function latex_document(doc, options)
  local vertical = false
  local function block_style(value)
    local p = properties(value.attributes)
    if not (p.align or p.indent) then return value end
    value.attributes['nb-align'] = nil; value.attributes['nb-indent'] = nil
    local body = value.t == 'Div' and value.content or pandoc.Blocks { value }
    if p.align then
      local command = ({ left = 'flushleft', center = 'center', right = 'flushright' })[p.align]
      if command then body:insert(1, pandoc.RawBlock('latex', '\\begin{' .. command .. '}')); body:insert(pandoc.RawBlock('latex', '\\end{' .. command .. '}')) end
    end
    if p.indent then
      body:insert(1, pandoc.RawBlock('latex', '\\begin{adjustwidth}{' .. p.indent * 2 .. 'em}{0pt}'))
      body:insert(pandoc.RawBlock('latex', '\\end{adjustwidth}'))
    end
    return body
  end
  doc = doc:walk {
    Span = function(value)
      local p, content = properties(value.attributes), value.content
      if p.color then content = surround(content, '\\textcolor[HTML]{' .. p.color .. '}{', '}', 'latex') end
      if p.background then content = surround(content, '\\colorbox[HTML]{' .. p.background .. '}{\\strut ', '}', 'latex') end
      return content
    end,
    Div = block_style, Header = block_style,
    Table = function(value)
      local function rows(items)
        for _, row in ipairs(items) do for _, cell in ipairs(row.cells) do
          local p = properties(cell.attributes)
          if p.vertical and p.vertical ~= 'top' then vertical = true end
          if p.background then
            -- A raw inline at the start of a cell keeps all its native blocks.
            local prefix = raw('latex', '\\cellcolor[HTML]{' .. p.background .. '}')
            if cell.contents[1] and (cell.contents[1].t == 'Para' or cell.contents[1].t == 'Plain') then cell.contents[1].content:insert(1, prefix)
            else cell.contents:insert(1, pandoc.Plain { prefix }) end
          end
        end end
      end
      rows(value.head.rows); rows(value.foot.rows)
      for _, body in ipairs(value.bodies) do rows(body.head); rows(body.body) end
      return value
    end,
  }
  local includes = doc.meta['header-includes'] or pandoc.MetaList {}
  includes[#includes + 1] = pandoc.MetaBlocks { pandoc.RawBlock('latex', '\\usepackage{xcolor}\n\\usepackage{colortbl}\n\\usepackage{changepage}') }
  doc.meta['header-includes'] = includes
  options.template = pandoc.template.compile(pandoc.template.default('latex'))
  if vertical then io.stderr:write('LaTeX 表格保留内容、列宽与合并；单元格垂直对齐由 TeX 排版决定。\n') end
  return pandoc.write(doc, 'latex', options)
end

function ByteStringWriter(doc, options)
  local target = pandoc.utils.stringify(doc.meta['noteboard-target'])
  doc.meta['noteboard-target'] = nil
  local output
  if target == 'docx' then output = word_document(doc, options)
  elseif target == 'latex' then output = latex_document(doc, options)
  else error('不支持的导出格式。') end
  if unsupported_color then io.stderr:write('部分导入颜色超出目标格式支持范围，正文已完整保留。\n') end
  return output
end
