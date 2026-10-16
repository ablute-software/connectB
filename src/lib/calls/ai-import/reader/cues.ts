// Prompt 917 (Adenda 1, Part B) — the words the platform's own form reader recognises, in Portuguese and English, in one place so they can be tuned.
// Every regular expression here answers ONE question about the text of ONE form item ("is this a yes/no?", "does it ask for a file?"); none of them looks at the
// rest of the document. Case and accents are folded by the reader before they are used (see fold()), so the patterns are written without accents.

/** Lower-case, accents removed: what every cue is matched against. */
export const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// --- Yes / No -----------------------------------------------------------------------------------------------------------------------------------
/** "(Sim ou Não)", "(S/N)", "Yes/No", "Sim ou não." — an explicit yes/no. */
export const YES_NO_CUE = /\(\s*(?:sim\s*(?:ou|\/)\s*nao|s\s*\/\s*n|yes\s*(?:or|\/)\s*no)\s*\)\s*\??|\b(?:sim\s+ou\s+nao|yes\s+or\s+no)\b\s*\.?/;
/** A question that starts like a yes/no question ("Existe…?", "Tem…?", "Vive em…?", "Has…?"). Weaker than an explicit cue. */
/** The same cue matched on the ORIGINAL text (with accents), to cut it out of a label. */
export const YES_NO_CUE_RAW = new RegExp(YES_NO_CUE.source.replace(/nao/g, 'n[aã]o'), 'i');
export const YES_NO_START = /^(?:existe|existem|tem|têm|tem\b|vive|vivem|esta|estao|e |sao |foi|foram|ja |possui|possuem|detem|a empresa (?:e|tem|esta)|o projeto (?:e|tem)|has|have|is|are|does|do you|did|was|were|can|will)\b/;
export const WH_WORD = /\b(?:qual|quais|quem|quanto|quantos|quantas|como|quando|onde|porque|porquê|por que|que tipo|what|which|who|how|when|where|why)\b/;

// --- Choice ---------------------------------------------------------------------------------------------------------------------------------------
/** "(selecione)", "(Selecionar)", "(escolha)", "(choose)": what introduces a list of options. */
export const CHOICE_CUE = /\(\s*(?:selecion\w*|escolh\w*|select\w*|choose\w*|assinale\w*)\s*\)/;
export const MULTIPLE_CUE = /selecione todos|selecione (?:uma ou mais|varias|as opcoes)|uma ou mais|escolha (?:varias|todas|uma ou mais)|assinale (?:todas|as opcoes)|one or more|select all|all that apply|multipl[ao]s? (?:escolhas|opcoes)|choose all/;

// --- Kinds ---------------------------------------------------------------------------------------------------------------------------------------
export const EMAIL_CUE = /\be-?mail\b|\bcorreio eletronico\b/;
export const URL_CUE = /\b(?:link|url|hiperligacao|ligacao para|website|web site|site da|sitio web|youtube|vimeo|linkedin)\b|https?:\/\//;
export const DATE_CUE = /^(?:\d+(?:\.\d+)*\.?\s*)?(?:data|date)\b|\bdd\s*\/\s*mm\s*\/\s*(?:aaaa|yyyy)\b|\bdata de (?:nascimento|constituicao|inicio|fim)\b/;
export const FILE_VERB = /\b(?:anex\w+|inclu\w+|upload|carregu\w+|submet\w+|insira|insere|attach\w*|include|submit|enviar|envie)\b/;
export const FILE_NOUN = /\b(?:documento\w*|apresentacao|plano de negocios|curriculo\w*|\bcv\b|declaracao|declaracoes|certidao|relatorio|demonstracoes|ficheiro|comprovativo|presentation|business plan|statement|certificate|document\w*|resume|report|deck|files?|spreadsheet)\b/;
export const OTHER_DOCUMENTS = /\boutros documentos\b|\bdocumentos adicionais\b|\boutra documentacao\b|\bother (?:relevant )?documents\b|\badditional documents\b/;
export const NUMBER_CUE = /\b(?:montante|valor|n\.?\s?[ºo°.]? de|numero de|quantos|quantas|quantidade|total de|percentagem|em euros|in euros|euros?|%|nr\.|number of|how many|amount)\b|€|\bem eur\b/;
export const LONG_TEXT_CUE = /\b(?:descreva|explique|resuma|sumario|resumo|descricao|breve descricao|justifique|detalhe|describe|explain|summar\w+|elaborate|outline|tell us)\b/;
export const LIMIT_CUE = /\b(?:maximo|max\.?|ate|no maximo|up to)\s+(?:de\s+)?\d+\s*(?:caracteres|palavras|characters|words)\b/;
/** Short answers the reader knows by name: it does not need a "rest of the questions" guess for them. */
export const SHORT_TEXT_CUE = /^(?:\d+(?:\.\d+)*\.?\s*)?(?:nome|name|morada|endereco(?! de e-?mail| do website)|address|cidade|city|codigo postal|postal code|zip|telefone|telemovel|phone|mobile|pais|country|nif|nipc|vat|cargo|role|title|designacao|nacionalidade|nationality|empresa|company|projeto|project)\b/;

// --- Context ------------------------------------------------------------------------------------------------------------------------------------
export const ATTACHMENTS_SECTION = /\b(?:anexos?|documentos|documentacao|attachments?|annex(?:es)?|appendix|documents)\b/;
/** "(opcional)", "(se aplicável)", "se disponível", "caso tenha": the question may be left empty. */
export const OPTIONAL_CUE = /\(\s*(?:opcional|optional|se aplicavel|if applicable|facultativ\w+)\s*\)|\bse disponiv\w+|\bse disponi\w+|\bif available\b|caso tenha disponivel|caso (?:o )?tenha|\bopcional\b|\boptional\b|\(se disponiveis\)/;
export const REQUIRED_CUE = /\bobrigatori[ao]s?\b|\bmandatory\b|\brequired\b|\*\s*$/;
/** "Se sim, …", "Se Não, …", "If yes, …": a follow-up that depends on the previous yes/no. */
export const IF_YES = /^(?:\d+(?:\.\d+)*\.?\s*)?(?:se\s+sim|if\s+yes)\b/;
export const IF_NO = /^(?:\d+(?:\.\d+)*\.?\s*)?(?:se\s+nao|if\s+no)\b/;
export const FOLLOW_UP_INLINE = /\?\s*(se\s+sim\b.*|if\s+yes\b.*)$/;
export const YES_NO_THEN_AMOUNT = /\?\s*(?:sim\s+ou\s+nao|yes\s+or\s+no)\s*\.?\s*((?:quanto|qual o valor|how much|qual o montante)\b.*\?)\s*$/;
/** A block the reader does not turn into questions: a template, a table, an example. */
export const STRUCTURE_MARKER = /\b(?:template|modelo de|tabela|table|quadro|exemplo\s*-)\b/;
export const TOPICS_PARENT = /seguintes (?:topicos|pontos|itens|temas)|following (?:topics|points|items)|abordar os seguintes|as follows|should cover/;
export const CV_CUE = /\bcurriculo\w*\b|\bcv\b|\bresume\b/;
export const PER_PERSON = /\bcada (?:promotor|elemento|membro|fundador|socio)\b|\bde cada\b|\beach (?:founder|team member|promoter|member)\b|\bper (?:person|member)\b/;
export const COMPANY_CONSTITUTED = /empresa (?:ja )?constituid|company (?:already )?(?:incorporated|registered)|incorporated company|registered company/;
export const ACCESS_CODE = /\bacesso a certidao\b|\bcodigo de acesso\b|\bacesso a\b.*\bcertidao permanente\b|\baccess code\b/;
export const PEOPLE_NOUNS = /promotor|elemento da equipa|membro|fundador|team member|founder|socio/;
export const AGE_OF_COMPANY = /(?:ha quanto tempo|idade da empresa|age of the (?:company|business)|quanto tempo (?:tem|criou)|since when|how long)/;
export const FORMAT_WORDS: { re: RegExp; format: 'pdf' | 'word' | 'excel' | 'powerpoint' | 'image' }[] = [
  { re: /powerpoint|\bpptx?\b|slides?\b/, format: 'powerpoint' },
  { re: /\bexcel\b|\bxlsx?\b|folha de calculo|spreadsheet/, format: 'excel' },
  { re: /\bword\b|\bdocx?\b/, format: 'word' },
  { re: /\bpdf\b/, format: 'pdf' },
  { re: /\bimagem\b|\bjpe?g\b|\bpng\b|\bfoto(?:grafia)?\b|\bimage\b|\bphoto\b/, format: 'image' },
];
