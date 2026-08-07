<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Backend for the registration page's 6-step wizard (database/content/
 * pages/form.json). The wizard's UI, step navigation and client-side
 * validation are already fully built in the template's JS and are staying
 * that way — see docs/content-seeding-plan.md §3.4. This provider only
 * gives that JS somewhere real to submit to: a `cecf_enquiry` post per
 * submission, visible/exportable from wp-admin, no forms-plugin
 * dependency.
 */
class CecfEnquiryServiceProvider extends ServiceProvider
{
    public const POST_TYPE = 'cecf_enquiry';

    public const REST_NAMESPACE = 'cecf/v1';

    public const REST_ROUTE = '/enquiries';

    /**
     * Fields the wizard collects, and whether each is required — mirrors
     * database/content/pages/form.json's `fields`/`checkboxes` so the
     * server enforces the same "required" set the client already does,
     * rather than trusting the client alone.
     *
     * @var array<string, bool>
     */
    protected const FIELDS = [
        'kind' => true,
        'gname' => true,
        'gknown' => false,
        'gdesc' => false,
        'county' => true,
        'ward' => false,
        'meet' => false,
        'cname' => true,
        'crole' => false,
        'cphone' => true,
        'cemail' => false,
        'reg' => false,
        'regno' => false,
        'members' => false,
        'acct' => false,
        'want' => false, // array of checkbox values
    ];

    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        add_action('init', [$this, 'registerPostType']);
        add_action('rest_api_init', [$this, 'registerRestRoute']);
    }

    public function registerPostType(): void
    {
        register_post_type(self::POST_TYPE, [
            'label' => __('Registration enquiries', 'cecf-sage'),
            'labels' => [
                'name' => __('Registration enquiries', 'cecf-sage'),
                'singular_name' => __('Registration enquiry', 'cecf-sage'),
            ],
            'public' => false,
            'publicly_queryable' => false,
            'show_ui' => true,
            'show_in_menu' => true,
            'show_in_rest' => false, // this CPT is written via the custom REST route below, not wp/v2
            'menu_icon' => 'dashicons-clipboard',
            'supports' => ['title', 'custom-fields'],
            'capability_type' => 'page',
            'map_meta_cap' => true,
        ]);
    }

    public function registerRestRoute(): void
    {
        register_rest_route(self::REST_NAMESPACE, self::REST_ROUTE, [
            'methods' => 'POST',
            'callback' => [$this, 'handleSubmission'],
            'permission_callback' => '__return_true', // public form; see class docblock re: follow-up rate limiting
            'args' => $this->restArgs(),
        ]);
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    protected function restArgs(): array
    {
        $args = [];

        foreach (array_keys(self::FIELDS) as $field) {
            $args[$field] = ['required' => false];
        }

        return $args;
    }

    public function handleSubmission(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $data = $this->sanitize($request);

        $missing = $this->missingRequiredFields($data);
        if ($missing !== []) {
            return new WP_Error(
                'cecf_enquiry_missing_fields',
                sprintf(
                    /* translators: %s: comma-separated list of field names */
                    __('Missing required fields: %s', 'cecf-sage'),
                    implode(', ', $missing)
                ),
                ['status' => 422]
            );
        }

        if (! $this->isValidKenyanPhone($data['cphone'])) {
            return new WP_Error(
                'cecf_enquiry_invalid_phone',
                __('That does not look like a Kenyan mobile number.', 'cecf-sage'),
                ['status' => 422]
            );
        }

        $postId = wp_insert_post([
            'post_type' => self::POST_TYPE,
            'post_status' => 'private',
            'post_title' => sprintf('%s — %s (%s)', $data['gname'], $data['cname'], $data['county']),
            'meta_input' => array_map(
                static fn ($value) => is_array($value) ? $value : (string) $value,
                $data
            ),
        ], true);

        if (is_wp_error($postId)) {
            return $postId;
        }

        return new WP_REST_Response([
            'id' => $postId,
            'county' => $data['county'],
            'phone' => $data['cphone'],
        ], 201);
    }

    /**
     * @return array<string, mixed>
     */
    protected function sanitize(WP_REST_Request $request): array
    {
        $data = [];

        foreach (array_keys(self::FIELDS) as $field) {
            $value = $request->get_param($field);

            if ($field === 'want') {
                $data[$field] = is_array($value) ? array_map('sanitize_text_field', $value) : [];

                continue;
            }

            if ($field === 'gdesc') {
                $data[$field] = sanitize_textarea_field((string) $value);

                continue;
            }

            if ($field === 'cemail' && $value) {
                $data[$field] = sanitize_email((string) $value);

                continue;
            }

            $data[$field] = $value !== null ? sanitize_text_field((string) $value) : '';
        }

        return $data;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return list<string>
     */
    protected function missingRequiredFields(array $data): array
    {
        $missing = [];

        foreach (self::FIELDS as $field => $required) {
            if ($required && trim((string) ($data[$field] ?? '')) === '') {
                $missing[] = $field;
            }
        }

        return $missing;
    }

    /**
     * Mirrors the client-side regex already shipped in
     * database/content/pages/form.json's `cphone` field validation note.
     */
    protected function isValidKenyanPhone(string $phone): bool
    {
        $normalised = preg_replace('/[\s\-()]/', '', $phone);

        return (bool) preg_match('/^(?:\+?254|0)?(7\d{8}|1\d{8})$/', $normalised);
    }
}
