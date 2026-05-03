from pathlib import Path

from pypdf import PdfReader

from scripts.export_oxsteed_flyer import (
    CTA_URL,
    FEATURE_CARDS,
    HOW_IT_WORKS_STEPS,
    PACKAGES,
    WHY_OXSTEED_POINTS,
    build_context,
    render_html,
    write_outputs,
)


def test_render_html_contains_print_contract_and_required_sections():
    html = render_html(build_context())

    assert "@media print" in html
    assert "@page" in html
    assert "OxSteed Consulting" in html
    assert "What We Offer" in html
    assert "How It Works" in html
    assert "Consulting Packages" in html
    assert "Why OxSteed?" in html
    assert "Ready to launch?" in html
    assert CTA_URL in html


def test_render_html_omits_large_services_grid_copy():
    html = render_html(build_context())

    assert "All 75 Services" not in html
    assert "100 Services across 18 Categories" not in html
    assert "75 Services" not in html


def test_flyer_uses_requested_three_consulting_packages():
    package_names = [package["name"] for package in PACKAGES]

    assert package_names == [
        "Initial Consultation",
        "Business Foundation",
        "Business Launch",
    ]


def test_content_blocks_have_expected_counts():
    assert len(FEATURE_CARDS) == 3
    assert len(HOW_IT_WORKS_STEPS) == 4
    assert len(WHY_OXSTEED_POINTS) == 4


def test_screen_html_keeps_reviewable_sections_visible():
    html = render_html(build_context())

    assert ".screen-only {\n      display: block;\n    }" in html
    assert ".print-only {\n      display: none;\n    }" in html


def test_write_outputs_generates_all_artifacts_and_two_page_pdf(tmp_path):
    outputs = write_outputs(tmp_path)

    expected = {
        "html": "oxsteed_flyer_v3_larger_font_true.html",
        "pdf": "oxsteed_flyer.pdf",
        "docx": "oxsteed_flyer.docx",
        "qr": "oxsteed_flyer_qr.png",
        "logo_png": "oxsteed_logo.png",
    }
    for key, filename in expected.items():
        assert outputs[key] == tmp_path / filename
        assert outputs[key].exists()
        assert outputs[key].stat().st_size > 0

    html_output = (tmp_path / expected["html"]).read_text(encoding="utf-8")
    assert CTA_URL in html_output
    assert "QR code for OxSteed consulting intake" in html_output
    assert "What We Offer" in html_output
    assert "How It Works" in html_output
    assert "Consulting Packages" in html_output

    reader = PdfReader(str(tmp_path / expected["pdf"]))
    assert 1 <= len(reader.pages) <= 2
