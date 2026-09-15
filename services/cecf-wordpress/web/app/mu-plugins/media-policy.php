<?php

/**
 * Media policy — R2 endpoint config, upload allow-list, compression.
 *
 * Always active (mu-plugins load unconditionally, no admin toggle to
 * accidentally leave off), unlike web/app/plugins/s3-uploads itself
 * (network-activated only when R2 is actually configured — see
 * docker/entrypoint.sh). Three unrelated concerns live in one file
 * because they're all "what happens to a file someone uploads" and
 * small enough not to warrant three:
 *
 *   1. Point the S3-Uploads plugin at Cloudflare R2's account-scoped
 *      endpoint (config/application.php defines the constants it reads
 *      directly; the endpoint/path-style override has to go through
 *      its own filter instead — see that file's comment on why).
 *   2. Restrict uploads to images, PDF and Office docs — explicitly no
 *      video/audio files. A group wanting to share a video links to it
 *      externally (YouTube/Vimeo oEmbed, a share link in a post) rather
 *      than uploading the file itself; nothing here blocks that, only
 *      direct video *file* uploads.
 *   3. Compress every image on the way in — mirrors packages/db/src/
 *      storage.ts's compressImage() on the Node side of esoqo, same
 *      reasoning: recompressing PDFs/docs generically isn't safe, but
 *      photos are almost always camera-resolution originals nobody
 *      will ever view at full size on a page.
 */

// ── 1. R2 endpoint ──────────────────────────────────────────────
// S3_UPLOADS_BUCKET/KEY/SECRET/REGION are Config::define()'d in
// config/application.php (only when R2_ACCOUNT_ID is set — this filter
// is a no-op otherwise, since S3-Uploads is never network-activated in
// that case either). Cloudflare R2's endpoint is account-scoped, not a
// real AWS region endpoint, so it has to be supplied through the
// plugin's own extension point rather than a constant it doesn't have.
add_filter('s3_uploads_s3_client_params', function (array $params): array {
    if (! defined('R2_ACCOUNT_ID_FOR_ENDPOINT')) {
        return $params;
    }

    $params['endpoint'] = 'https://' . R2_ACCOUNT_ID_FOR_ENDPOINT . '.r2.cloudflarestorage.com';
    $params['use_path_style_endpoint'] = true;

    return $params;
});

// R2_ACCOUNT_ID isn't itself a WordPress constant (Config::define only
// covers what S3-Uploads reads by name) — define one here, once, from
// the same env var, so the filter above doesn't need its own env()
// lookup this early in a request where Dotenv may not have run yet in
// every context mu-plugins execute in.
if (! defined('R2_ACCOUNT_ID_FOR_ENDPOINT') && getenv('R2_ACCOUNT_ID')) {
    define('R2_ACCOUNT_ID_FOR_ENDPOINT', getenv('R2_ACCOUNT_ID'));
}

// ── 2. Upload allow-list ────────────────────────────────────────
// Replaces WordPress's much broader default allow-list (which
// includes video, audio, archives, and a long tail of legacy office
// formats) with exactly: images, PDF, and Word/Excel documents.
add_filter('upload_mimes', function (array $mimes): array {
    return [
        'jpg|jpeg|jpe' => 'image/jpeg',
        'png'          => 'image/png',
        'gif'          => 'image/gif',
        'webp'         => 'image/webp',
        'pdf'          => 'application/pdf',
        'doc'          => 'application/msword',
        'docx'         => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls'          => 'application/vnd.ms-excel',
        'xlsx'         => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
});

// Defence in depth for the same allow-list, at the point WordPress has
// already sniffed the real file type (wp_check_filetype_and_ext() —
// finfo-based, not just the extension upload_mimes matches on) — belt
// and braces against a mis-registered MIME slipping through, same
// spirit as packages/db/src/storage.ts's sniff() on the Node side,
// though WP's own core sniffing is what does the actual verification
// here rather than a hand-rolled magic-byte check.
add_filter('wp_check_filetype_and_ext', function (array $data, string $file, string $filename) {
    $allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

    if ($data['type'] && ! in_array($data['type'], $allowed, true)) {
        $data['ext'] = false;
        $data['type'] = false;
        $data['proper_filename'] = false;
    }

    return $data;
}, 10, 3);

// ── 3. Compression ──────────────────────────────────────────────
// WP core already downscales any upload wider/taller than this many
// pixels before generating the "original" size everything else derives
// from (wp_generate_attachment_metadata) — lower than core's own 2560
// default for real savings on typical camera-resolution uploads,
// matching packages/db's own 2000px cap on the Node side.
add_filter('big_image_size_threshold', fn() => 2000);

// JPEG re-encode quality — core defaults to 82; a few points lower is
// not visibly different at the sizes these actually render at, and
// meaningfully smaller. PNGs aren't re-encoded here (no equivalent
// "quality" lever in WP core's own image editor for PNG the way there
// is for JPEG); the Node-side compressImage() does do PNG palette
// quantisation, an asymmetry that's fine — WordPress's own media
// library has no equivalent hook to plug that into generically.
add_filter('wp_editor_set_quality', function ($quality, $mime_type) {
    return $mime_type === 'image/jpeg' ? 78 : $quality;
}, 10, 2);
