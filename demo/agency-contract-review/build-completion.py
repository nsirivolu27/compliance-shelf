"""Build the additive, fictional conclusion to the contract review exercise.

Uses the author's PDF tooling, not an application dependency. Earlier files are untouched.
"""
import hashlib
import json
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

root = Path(__file__).resolve().parent
banner = 'SYNTHETIC DEMONSTRATION — NOT AN OFFICIAL AGENCY RECORD.'
documents = [
    ('09', '2.0', 'Final keyboard retest', 'SYN-EVAL-06', 'accessibility-conformance', [
        ('Scope and replacement build', 'This final retest supplements DOC-04 v1.0 and DOC-09 v1.0; both remain historical evidence. The vendor issued correction build SYN-BUILD-1.2.1 on 2026-11-10. It replaces delivered build SYN-BUILD-1.2.0 for the fictional release-1.2 delivery. The evaluator tested the replacement on 2026-11-11 through 2026-11-13.'),
        ('Tests performed', 'Manual keyboard testing covered home, service search, office locator, appointment date selection, time selection, and confirmation dialog. KB-01: Tab reaches the date picker, arrow keys select dates, and focus stays visible. KB-02: Escape dismisses the confirmation dialog and restores focus to its opening control. Tab, Shift+Tab, Enter and Escape regression checks passed in those six flows.'),
        ('Recorded result', 'KB-01 and KB-02 passed the final retest on SYN-BUILD-1.2.1. No open high-severity keyboard defect remains in the six tested flows. This sentence is a scripted fictional test result, not a claim that this platform tested an actual VA system.'),
        ('Evidence boundary', 'The tested scope is the six flows named above. Help pages and downloadable forms are excluded from this acceptance exercise, not silently marked as tested. SYN-EVAL-06 records the result; SYN-AR-03 reviews its use for the stated contract checks. This is not a Section 508 certification.'),
    ]),
    ('03', '2.0', 'Corrected vendor declaration', 'SYN-VDL-04', 'accessibility-conformance', [
        ('Correction to the earlier declaration', 'The broad statement in DOC-03 v1.0 is withdrawn for the current acceptance review. That earlier file remains available. This declaration addresses only correction build SYN-BUILD-1.2.1 and the six flows tested in DOC-09 v2.0.'),
        ('Current statement', 'The vendor declaration now names SYN-BUILD-1.2.1 and agrees with the final evaluator report. KB-01 and KB-02 are recorded as corrected and retested. The vendor makes no statement here about excluded pages, downloadable forms, other releases, or legal certification.'),
        ('Acknowledgment', 'Fictional vendor lead SYN-VDL-04 recorded this correction on 2026-11-14. Fictional reviewer SYN-AR-03 compared it with DOC-09 v2.0 on 2026-11-16. Corrective action CA-02 is addressed by this version, not by erasing the previous declaration.'),
    ]),
    ('02', '2.0', 'Reconciled delivery register and replacement receipt', 'SYN-COR-02', 'delivery-traceability', [
        ('Version trail', 'DOC-02 v1.0 and DOC-05 v1.0 remain the receipt for SYN-BUILD-1.2.0. Correction package SYN-PKG-1.2.1 was received on 2026-11-14 under fictional receipt SYN-RECEIPT-121. Package label, installed build display and evaluator installation log each identify SYN-BUILD-1.2.1. These are fictional reference identifiers, not cryptographic build attestations.'),
        ('Reconciled items', 'D-02: corrected vendor statement DOC-03 v2.0. D-03: final evaluator retest DOC-09 v2.0. D-04: replacement package SYN-PKG-1.2.1, recorded in receipt SYN-RECEIPT-121. All three items cover the same correction build and the six-flow acceptance scope.'),
        ('Traceability conclusion', 'The delivered replacement and evaluated replacement both identify SYN-BUILD-1.2.1. The original release mismatch remains recorded in the history and is addressed by this replacement receipt and retest.'),
    ]),
    ('06', '3.0', 'Completed acceptance evidence review', 'SYN-COR-02', 'acceptance-review', [
        ('Review basis', 'This review applies the three fictional SOW DOC-01 checks to the six-flow delivery scope. Public Section 508 references provide background; this exercise records no actual agency determination. Earlier acceptance memos v1.0 and v2.0 remain part of the file.'),
        ('Evidence reviewed', 'SYN-AR-03 reviewed DOC-09 v2.0 and DOC-03 v2.0 for accessibility evidence on SYN-BUILD-1.2.1. SYN-COR-02 reconciled the replacement receipt in DOC-02 v2.0. Each names the same replacement build. The excluded help pages and downloads are outside this stated exercise.'),
        ('Acknowledgment and recommendation', 'SYN-AR-03 acknowledges the final evidence for the stated six-flow acceptance scope. SYN-COR-02 records that the three evidence checks are complete and recommends the packet for the fictional contracting officer review. This is a recommendation with a simulated acknowledgment, not an executed contract acceptance or authorization of payment.'),
        ('Corrective actions', 'CA-01: final retest received and reviewed. CA-02: corrected vendor statement received and reviewed. CA-03: reviewer acknowledgment recorded above. Completion is supported by new evidence; completing a task alone is insufficient.'),
        ('Records protection', 'Hold SYN-HOLD-2026-07 remains active on the delivery file, including all new versions. Completing the evidence review neither releases that hold nor permits destruction.'),
    ]),
    ('10', '1.0', 'Training review basis and records instructions', 'SYN-RO-05', 'records-hold', [
        ('Training assumptions', 'For this synthetic exercise only, the reviewer confirms the fictional SOW DOC-01 criteria and six-flow scope as the review basis. Section 508 source links remain background references, not an official applicability decision. No real agency policy approval is represented.'),
        ('Fictional schedule decision', 'Fictional records officer SYN-RO-05 assigns both record series to training schedule SYN-TRAINING-RET-01, item DEMO-01: retain for six years after final payment. This invented training schedule is not a NARA-approved authority and must never be used on real records. It exists to demonstrate the audited schedule-review workflow.'),
        ('Trigger evidence', 'The scenario stipulates final payment on 2026-11-19 under fictional receipt SYN-PAY-2026-019. This is training data, not a transaction performed or authorized by the application. The corresponding review date is 2032-11-19; that date is not permission to destroy.'),
        ('Hold review', 'SYN-HOLD-2026-07 remains active on release-1.2 delivery records and the replacement-build review materials. Release-1.1 working files remain outside this hold. Both series are retained. A completed evidence review does not settle the fictional protest inquiry or release a hold.'),
    ]),
]

font = Path('C:/Windows/Fonts/segoeui.ttf')
if font.exists():
    pdfmetrics.registerFont(TTFont('Body', str(font)))
    body_font = 'Body'
else:
    body_font = 'Helvetica'
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='BodyCopy', fontName=body_font, fontSize=10, leading=14, spaceAfter=9))
styles.add(ParagraphStyle(name='Notice', fontName=body_font, fontSize=8, leading=11, textColor=colors.HexColor('#475569'), spaceAfter=12))
styles['Title'].fontSize = 19
styles['Title'].leading = 23
styles['Title'].alignment = TA_LEFT
styles['Heading2'].fontSize = 12
styles['Heading2'].spaceBefore = 10
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
scenario = json.loads((root / 'scenario.json').read_text(encoding='utf-8'))
for number, version, title, author, check, sections in documents:
    doc_id = f'SYN-VAP-DOC-{number}'
    stem = f'{doc_id}_v{version}'
    metadata = f'{doc_id} | Version {version} | 2026-11-20 | {author} (fictional)'
    text = banner + '\n\n# ' + title + '\n\n' + metadata + '\n\nContract: SYN-VA-PORTAL-2026-001 (fictional). Stage: completion.\n\n'
    for heading, paragraph in sections:
        text += f'## {heading}\n\n{paragraph}\n\n'
    text += 'Signature: not applied. All names, receipts, builds and decisions are synthetic.\n'
    companion = root / 'text' / (stem + '.md')
    companion.write_bytes(text.encode('utf-8'))
    pdf = root / 'originals' / (stem + '.pdf')
    story = [Paragraph(banner, styles['Notice']), Paragraph(escape(title), styles['Title']), Paragraph(metadata, styles['Notice']), Paragraph('Contract: SYN-VA-PORTAL-2026-001 (fictional). Stage: completion.', styles['BodyCopy'])]
    for heading, paragraph in sections:
        story.extend([Paragraph(escape(heading), styles['Heading2']), Paragraph(escape(paragraph), styles['BodyCopy'])])
    story.append(Paragraph('Signature: not applied. All roles and decisions are fictional.', styles['Notice']))
    def footer(canvas, doc):
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(colors.HexColor('#475569'))
        canvas.drawString(48, 26, f'{doc_id} v{version} | Training material only')
        canvas.drawRightString(564, 26, f'Page {doc.page}')
    SimpleDocTemplate(str(pdf), pagesize=(612,792), leftMargin=48, rightMargin=48, topMargin=38, bottomMargin=46, title=title, author='Synthetic demonstration').build(story, onFirstPage=footer, onLaterPages=footer)
    def file_info(path, media_type):
        data = path.read_bytes()
        return {'path':path.relative_to(root).as_posix(), 'sha256':hashlib.sha256(data).hexdigest(), 'bytes':len(data), 'mediaType':media_type}
    entry = {'documentId':doc_id,'version':version,'title':title,'stage':'completion','authorRole':author,'date':'2026-11-20','relationship':{'type':'supplements','note':'Earlier versions remain historical evidence.'},'files':{'original':file_info(pdf,'application/pdf'),'companion':file_info(companion,'text/markdown')}}
    manifest['documents'] = [item for item in manifest['documents'] if (item['documentId'],item['version']) != (doc_id,version)] + [entry]
    scenario['documents'] = [item for item in scenario['documents'] if (item['id'],item['version']) != (doc_id,version)] + [{'id':doc_id,'version':version,'title':title,'stage':'completion','check':check}]
manifest['completionNote'] = 'Additive fictional resolution on correction build 1.2.1. The training schedule is invented, not legal authority; the active hold remains.'
(root / 'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(root / 'scenario.json').write_text(json.dumps(scenario,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Created five completion PDFs and matching text companions; earlier versions preserved.')
