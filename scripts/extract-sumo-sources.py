from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "public" / "Sources"
PDFS = [
    SOURCES / "SUMO_Bible_draft_5.pdf",
    SOURCES / "Sumo MM Communications and Conduct.pdf",
]


def extract_pdf(pdf_path: Path) -> str:
    pages: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(layout=True, x_tolerance=1, y_tolerance=3) or ""
            pages.append(f"===== PAGE {index} =====\n{text.rstrip()}")
    return "\n\n".join(pages).rstrip() + "\n"


def main() -> None:
    for pdf in PDFS:
        output = pdf.with_suffix(".txt")
        output.write_text(extract_pdf(pdf), encoding="utf-8")
        print(f"Wrote {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
