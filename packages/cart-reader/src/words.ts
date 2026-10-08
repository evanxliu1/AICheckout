// Label vocabulary of cart summaries, in many languages. All tests run on lower-cased, whitespace-normalized text with
// the amounts removed. Generic words only: nothing here names a store.

/** Rows that are never a total, whatever else they say: savings, promotions, points, instalments. */
export const EXCLUDE_RE =
  /sav(?:e|ing)|discount|rabat|descuento|desconto|remise|r[ée]duction|sconto|korting|zni[żz]k|indirim|割引|할인|خصم|promo|coupon|kupon|voucher|c[óo]digo|\bcode\b|economi|ahorr|risparm|bespaar|\boff\b|\bpoints?\b|punkte|puntos|punti|reward|cashback|\bearn|per month|\/\s?mo\b|monthly|instal|klarna|afterpay|affirm|financ|\bfee\b|donation|deposit|away from|more to|orders? over|\bminimum\b|\bmin\.|\bmrp\b|\brrp\b|\buvp\b|list price|add to (?:cart|bag|basket)|in den warenkorb|ajouter au|a[ñn]adir al|aggiungi al|toevoegen|\breviews?\b|bewertung|avis\b|rese[ñn]a/u;

/** Shipping and tax words: a row is excluded when it has one of these and no inclusion/exclusion preposition. */
export const SHIP_RE =
  /ship|deliver|liefer|versand|livraison|env[ií]o|bezorg|verzend|spedizion|consegna|frete|entrega|dostaw|wysy[łl]|kargo|teslimat|配送|送料|배송|شحن|توصيل|\bporto\b|frakt|leverans|levering|handling/u;
export const TAX_RE =
  /\btax|\bvat\b|\bgst\b|\bhst\b|\bpst\b|\bqst\b|mwst|\bust\b|steuer|\biva\b|\btva\b|\bbtw\b|impuest|imposto|imp[ôo]t|imposta|podatek|\bkdv\b|税|세금|ضريب|\bmoms\b|skatt/u;
export const PREP_RE =
  /incl|inkl|excl|exkl|\bexc\b|before|after|pre-?\s?tax|\bwith\b|without|\bsans\b|\bhors\b|\bttc\b|\bht\b|税込|税抜|込|抜|포함|제외|zzgl|compris|\bavec\b|escl|senza|\bcon\b|\bsin\b|zonder|ohne|inbegrepen|w tym|\bz\b|\bbez\b|dahil|hariç|شامل|\bnet\b|brut|gross|\+|\bplus\b/u;

/** Items total. Tested before TOTAL_RE, since most of these contain a total word. */
export const SUBTOTAL_RE =
  /sub-?\s?tot|subtotaal|zwischen|sous-?\s?total|sottototale|subtotale|delsumma|mellansumma|suma cz[ęe][śs]ciowa|warto[śs][ćc] (?:produkt|koszyk|towar)|cena produkt|ara toplam|小計|小计|商品合計|商品小計|商品金額|소계|상품\s?금액|주문\s?금액|المجموع الفرعي|مجموع المنتجات|merchandise|warenwert|artikelsumme|items?\s*\(?\s*\d*\s*\)?\s*:?\s*(?:sub)?total|total(?:e|aal)?\s(?:de\s|dei\s|des\s|van\s)?(?:prod|art[ií]|produit|producto)/u;

/** Order total, with or without tax or shipping. */
export const TOTAL_RE =
  /tota(?:l|al)|gesamt|endsumme|endbetrag|bestellsumme|rechnungsbetrag|summa|\bsuma\b|razem|zap[łl]aty|toplam|合計|総計|総額|总计|总额|總計|总价|合计|결제|합계|총액|الإجمالي|الاجمالي|إجمالي|اجمالي|المجموع|итого|всего|к оплате|[àa] payer|a pagar|zu zahlen|te betalen|att betala|amount due|payment due|お支払い|支払い?金額/u;

/** An order total, as opposed to a bare "total" that may be the items total: used only to break a tie. */
export const GRAND_RE =
  /grand|order total|total (?:de la |du )?commande|total (?:del )?pedido|totale ordine|totaal bestelling|bestellsumme|gesamtsumme|gesamtbetrag|endsumme|endbetrag|rechnungsbetrag|to pay|[àa] payer|a pagar|zu zahlen|te betalen|att betala|amount due|payment due|お支払い|결제/u;

/** A total after a gift card, store credit or points: only when a credit row is on the page. */
export const AFTER_RE = /\bdue\b|after|remaining|verbleib|restbetrag|balance/u;

/** A credit row: negative amount with one of these words. */
export const CREDIT_RE =
  /gift|geschenk|cadeau|regalo|credit|cr[ée]dit|guthaben|tegoed|\bpoints?\b|punkte|puntos|punti|reward|loyalty|voucher|wallet|balance|\bavoir\b|store credit/u;

/** Any summary label at all (cheap gate while climbing from an amount to its row). */
export const ANY_LABEL_RE = new RegExp(
  `${SUBTOTAL_RE.source}|${TOTAL_RE.source}|${AFTER_RE.source}|${CREDIT_RE.source}`,
  'u',
);

/** Checkout controls, used only to tell a cart summary from a block elsewhere on the page. */
export const CHECKOUT_RE =
  /check\s?out|proceed|place order|pay now|kasse|bestellen|commander|paiement|pagar|comprar|finalizar|acquista|\bpaga\b|cassa|afrekenen|betalen|kassan|betala|do kasy|zam[óo]w|ödeme|購入|レジ|会計|결제하기|주문하기|الدفع|إتمام/u;

export type Kind = 'afterCredit' | 'estimatedTotal' | 'subtotal';

/** Classifies a row label (amounts removed, lower-cased). `null` when it is not a summary total row. */
/** Line-item and table-header rows (quantity columns), and unrendered templates. */
export const LINE_ITEM_RE =
  /\bqty\b|quantit|menge|anzahl|cantidad|aantal|ilo[śs][ćc]|\badet\b|数量|수량|الكمية|\{\{|\}\}|(?:product|article|artikel|art[ií]culo|articolo|item)s?\b.*\b(?:price|prix|preis|precio|prezzo|prijs)/u;

/** "Total after savings", "total with discount": a qualifier on a total, not a savings row. Stripped before classifying. */
const QUALIFIED_SAVINGS_RE =
  /(?:after|with|incl\w*|net of|nach|avec|apr[èe]s|con|tras|dopo|na|po|met)\s+(?:all\s+)?(?:sav\w+|discounts?|promotions?|coupons?|rabat\w*|descuentos?|remises?|r[ée]ductions?|sconti?|korting)/gu;

export function classifyLabel(raw: string): Kind | 'after-candidate' | null {
  const label = raw.replace(QUALIFIED_SAVINGS_RE, ' ');
  if (label.length > 80 || EXCLUDE_RE.test(label) || LINE_ITEM_RE.test(label)) return null;
  // A number right before the total word ("500 Total") is a product name, not a label.
  if (/\d\s*(?:tota|gesamt)/u.test(label)) return null;
  if ((SHIP_RE.test(label) || TAX_RE.test(label)) && !PREP_RE.test(label)) return null;
  if (SUBTOTAL_RE.test(label)) return 'subtotal';
  if (AFTER_RE.test(label)) return 'after-candidate';
  if (TOTAL_RE.test(label)) return 'estimatedTotal';
  return null;
}
