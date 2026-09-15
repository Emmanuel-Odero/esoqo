import 'dart:typed_data';

import 'package:barcode_widget/barcode_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'parcel_models.dart';
import 'parcels_repository.dart';

final parcelLabelProvider = FutureProvider.autoDispose
    .family<ParcelLabel, String>(
      (ref, code) => ref.watch(parcelsRepositoryProvider).label(code),
    );

/// The physical parcel label a handler/courier prints and sticks on
/// the package — deliberately just the code, QR and barcode, nothing
/// else. Sender/receiver/route/weight used to print here too, but a
/// label rides in the open on a box in transit and gets handled by
/// people who never open the app — the actual shipment details now
/// live behind a scan instead (see UniversalScanScreen resolving a
/// PKG- code through this same GetParcelLabel endpoint), so the paper
/// itself stays small enough for a standard thermal label printer
/// (60mm x 40mm) instead of needing a full sheet. Reached only from
/// the parcel status screen's "Print label" action, itself only shown
/// to a signed-in user — the server is the real gate (GET
/// /v1/parcels/:code/label 403s for anyone not holding/assigned to
/// this parcel or without parcels.read), so an unauthorized visitor
/// here just sees the same denial EsoqoAsyncView already renders for
/// any other ApiException.
class ParcelLabelScreen extends ConsumerWidget {
  const ParcelLabelScreen({super.key, required this.code});
  final String code;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final label = ref.watch(parcelLabelProvider(code));
    return Scaffold(
      appBar: EsoqoAppBar(
        title: 'Parcel label',
        actions: [
          if (label.hasValue)
            IconButton(
              icon: const Icon(Icons.print_outlined),
              tooltip: 'Print',
              onPressed: () => _print(label.requireValue),
            ),
        ],
      ),
      body: SafeArea(
        child: EsoqoAsyncView(
          value: label,
          onRetry: () => ref.invalidate(parcelLabelProvider(code)),
          data: (context, l) => Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: ListView(
                padding: const EdgeInsets.all(EsoqoSpacing.s5),
                children: [
                  EsoqoCard(child: _LabelContent(code: l.code)),
                  const SizedBox(height: EsoqoSpacing.s5),
                  EsoqoButton.primary(
                    label: 'Print label',
                    icon: Icons.print_outlined,
                    expand: false,
                    onPressed: () => _print(l),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _print(ParcelLabel l) async {
    await Printing.layoutPdf(
      onLayout: (format) => _buildPdf(l.code),
      format: const PdfPageFormat(60 * PdfPageFormat.mm, 40 * PdfPageFormat.mm),
    );
  }
}

/// The on-screen preview — the same content [_buildPdf] renders to
/// paper, so what a handler sees before printing is what actually
/// comes out. Also what [ParcelPreLabelStrip] (a blank, not-yet-booked
/// label) renders — same code, same QR/barcode, no shipment fields
/// either way since a blank label has none yet.
class _LabelContent extends StatelessWidget {
  const _LabelContent({required this.code});
  final String code;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          code,
          textAlign: TextAlign.center,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 22),
        ),
        const SizedBox(height: EsoqoSpacing.s4),
        Semantics(
          label: 'QR code for parcel $code',
          child: Center(
            child: Container(
              padding: const EdgeInsets.all(EsoqoSpacing.s3),
              decoration: BoxDecoration(
                border: Border.all(color: EsoqoColors.line),
                borderRadius: BorderRadius.circular(EsoqoRadius.md),
              ),
              child: QrImageView(data: code, size: 140, backgroundColor: Colors.white),
            ),
          ),
        ),
        const SizedBox(height: EsoqoSpacing.s4),
        Semantics(
          label: 'Barcode for parcel $code',
          child: Container(
            height: 64,
            padding: const EdgeInsets.symmetric(horizontal: EsoqoSpacing.s3),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: EsoqoColors.line),
              borderRadius: BorderRadius.circular(EsoqoRadius.md),
            ),
            child: BarcodeWidget(
              barcode: Barcode.code128(),
              data: code,
              color: Colors.black,
              drawText: false,
            ),
          ),
        ),
      ],
    );
  }
}

/// Renders just [code] — big text, QR, barcode — onto a 60mm x 40mm
/// label (a standard small thermal-label size, what most handheld
/// label printers take), for [Printing.layoutPdf].
Future<Uint8List> _buildPdf(String code) async {
  final doc = pw.Document();
  final qrImage = await QrPainter(
    data: code,
    version: QrVersions.auto,
    gapless: true,
  ).toImageData(300);
  doc.addPage(
    pw.Page(
      pageFormat: const PdfPageFormat(60 * PdfPageFormat.mm, 40 * PdfPageFormat.mm),
      margin: const pw.EdgeInsets.all(6),
      build: (context) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.center,
        mainAxisAlignment: pw.MainAxisAlignment.center,
        children: [
          pw.Text(
            code,
            textAlign: pw.TextAlign.center,
            style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold),
          ),
          pw.SizedBox(height: 4),
          pw.Image(pw.MemoryImage(qrImage!.buffer.asUint8List()), width: 70, height: 70),
          pw.SizedBox(height: 4),
          pw.BarcodeWidget(
            barcode: pw.Barcode.code128(),
            data: code,
            drawText: false,
            height: 24,
          ),
        ],
      ),
    ),
  );
  return doc.save();
}
