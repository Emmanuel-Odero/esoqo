<?php

namespace Database\Seeders;

use App\Content\ContentRepository;
use RuntimeException;
use WP_Query;

/**
 * Sideloads the deduped illustration SVGs (database/content/media/
 * illustrations/*.svg) into the media library, once each. Idempotent:
 * re-running matches existing attachments by a `_cecf_illustration_filename`
 * meta key rather than re-uploading duplicates.
 *
 * Does not touch database/content/media/photos/ (see PLACEHOLDERS.md — no
 * files exist there to seed) or media/icons/ (theme build assets, not
 * media-library content — see icons/README.md).
 */
class MediaSeeder
{
    public function __construct(protected ContentRepository $content)
    {
    }

    /**
     * @return array<string, int> filename => attachment post ID
     */
    public function run(): array
    {
        $map = [];

        // WordPress core doesn't allow SVG uploads by default (a
        // reasonable stored-XSS precaution — an SVG can carry a <script>
        // tag). These 8 illustrations are theme-authored, not
        // user-submitted, so the risk that filter guards against doesn't
        // apply here; scoping it to just this method call rather than a
        // permanent site-wide filter keeps that hole closed for every
        // other upload (including a future CECF staff member uploading
        // an SVG logo through the ordinary media library).
        add_filter('upload_mimes', [$this, 'allowSvgMime']);

        try {
            foreach ($this->content->illustrations() as $filename => $path) {
                $map[$filename] = $this->upsert($filename, $path);
            }
        } finally {
            remove_filter('upload_mimes', [$this, 'allowSvgMime']);
        }

        return $map;
    }

    /**
     * @param  array<string, string>  $mimes
     * @return array<string, string>
     */
    public function allowSvgMime(array $mimes): array
    {
        $mimes['svg'] = 'image/svg+xml';

        return $mimes;
    }

    protected function upsert(string $filename, string $path): int
    {
        $existingId = $this->findExisting($filename);
        if ($existingId) {
            return $existingId;
        }

        $contents = file_get_contents($path);
        if ($contents === false) {
            throw new RuntimeException("Could not read illustration file: {$path}");
        }

        $upload = wp_upload_bits($filename, null, $contents);
        if (! empty($upload['error'])) {
            throw new RuntimeException("Failed to write illustration to uploads: {$filename} — {$upload['error']}");
        }

        $attachmentId = wp_insert_attachment([
            'post_mime_type' => 'image/svg+xml',
            'post_title' => pathinfo($filename, PATHINFO_FILENAME),
            'post_content' => '',
            'post_status' => 'inherit',
        ], $upload['file']);

        if (is_wp_error($attachmentId)) {
            throw new RuntimeException("Failed to insert attachment for {$filename}: ".$attachmentId->get_error_message());
        }

        update_post_meta($attachmentId, '_cecf_illustration_filename', $filename);

        return $attachmentId;
    }

    protected function findExisting(string $filename): ?int
    {
        $query = new WP_Query([
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'meta_key' => '_cecf_illustration_filename',
            'meta_value' => $filename,
            'fields' => 'ids',
            'posts_per_page' => 1,
            'no_found_rows' => true,
        ]);

        return $query->posts[0] ?? null;
    }
}
