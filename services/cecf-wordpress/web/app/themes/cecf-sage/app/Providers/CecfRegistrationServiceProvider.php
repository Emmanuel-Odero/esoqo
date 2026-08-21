<?php

namespace App\Providers;

use App\Support\CecfApiClient;
use Illuminate\Support\ServiceProvider;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Backend for the real registration wizard (resources/js/registration.js,
 * partials/cecf/registrationForm.blade.php) — individual, group and
 * business, all three. Where CecfEnquiryServiceProvider stored a lead
 * locally in a private `cecf_enquiry` post (never actually wired to a
 * rendered form — nothing posts to it), this is the real thing: every
 * route here is a thin same-origin proxy in front of esoko's
 * `services/core` `/api/cecf/*` facade (App\Support\CecfApiClient),
 * which is itself a thin proxy over the *same* @esoko/db functions
 * esoko's own /join Server Actions call. No business logic — validation,
 * duplicate handling, the funnel→Party transaction — is duplicated here;
 * esoko's facade is the authoritative side, this just forwards and
 * relays its response.
 *
 * The browser's own JS never sees CECF_SERVICE_SECRET or esoko's core
 * URL directly — it only ever calls this site's own `cecf/v1` routes,
 * same-origin, no CORS, no secret exposure. This class holds the secret
 * server-side via CecfApiClient.
 *
 * Public, unauthenticated routes by design (a registrant has no WP
 * account) — same posture as CecfEnquiryServiceProvider's REST route.
 * Rate limiting lives on esoko's own core service (120 req/min,
 * services/core/src/index.ts), not duplicated here.
 */
class CecfRegistrationServiceProvider extends ServiceProvider
{
    public const REST_NAMESPACE = 'cecf/v1';

    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        add_action('rest_api_init', [$this, 'registerRoutes']);
    }

    public function registerRoutes(): void
    {
        register_rest_route(self::REST_NAMESPACE, '/registration/start', [
            'methods' => 'POST',
            'callback' => [$this, 'start'],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route(self::REST_NAMESPACE, '/registration/(?P<id>[a-f0-9\-]{36})/documents', [
            'methods' => 'POST',
            'callback' => [$this, 'documents'],
            'permission_callback' => '__return_true',
            'args' => ['id' => ['required' => true]],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/registration/(?P<id>[a-f0-9\-]{36})/pay-later', [
            'methods' => 'POST',
            'callback' => [$this, 'payLater'],
            'permission_callback' => '__return_true',
            'args' => ['id' => ['required' => true]],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/registration/(?P<id>[a-f0-9\-]{36})/progress', [
            'methods' => 'POST',
            'callback' => [$this, 'progress'],
            'permission_callback' => '__return_true',
            'args' => ['id' => ['required' => true]],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/registration/(?P<id>[a-f0-9\-]{36})/declare-payment', [
            'methods' => 'POST',
            'callback' => [$this, 'declarePayment'],
            'permission_callback' => '__return_true',
            'args' => ['id' => ['required' => true]],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/registration/(?P<id>[a-f0-9\-]{36})/complete', [
            'methods' => 'POST',
            'callback' => [$this, 'complete'],
            'permission_callback' => '__return_true',
            'args' => ['id' => ['required' => true]],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/payments/mpesa/initiate', [
            'methods' => 'POST',
            'callback' => [$this, 'mpesaInitiate'],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route(self::REST_NAMESPACE, '/payments/pesapal/initiate', [
            'methods' => 'POST',
            'callback' => [$this, 'pesapalInitiate'],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route(self::REST_NAMESPACE, '/payments/(?P<id>[a-f0-9\-]{36})/status', [
            'methods' => 'GET',
            'callback' => [$this, 'paymentStatus'],
            'permission_callback' => '__return_true',
            'args' => ['id' => ['required' => true]],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/groups/search', [
            'methods' => 'GET',
            'callback' => [$this, 'groupsSearch'],
            'permission_callback' => '__return_true',
        ]);
    }

    /* ── handlers — each is a thin forward, response shape mirrors
     *    esoko's own {ok, ...} so registration.js has one error path ── */

    public function start(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $body = $request->get_json_params();

        if (! is_array($body) || empty($body['joiningAs']) || empty($body['registrant'])) {
            return new WP_Error(
                'cecf_bad_request',
                __('Missing registration details.', 'cecf-sage'),
                ['status' => 422],
            );
        }

        return $this->relay(CecfApiClient::post('/api/cecf/registration/start', $body));
    }

    public function documents(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $body = $request->get_json_params();

        if (! is_array($body) || empty($body['documents'])) {
            return new WP_Error('cecf_bad_request', __('No files were attached.', 'cecf-sage'), ['status' => 422]);
        }

        return $this->relay(CecfApiClient::post(
            "/api/cecf/registration/{$request->get_param('id')}/documents",
            $body,
        ));
    }

    public function payLater(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        return $this->relay(CecfApiClient::post(
            "/api/cecf/registration/{$request->get_param('id')}/pay-later",
            [],
        ));
    }

    /**
     * Best-effort drop-off ping — registration.js fires this after every
     * step transition so admin's Registrations table can show where a
     * given registrant is stuck, not just that they're STARTED. Never
     * something the wizard should block on, so unlike every other
     * handler here this deliberately doesn't validate $body first: a
     * malformed or missing step just gets forwarded as-is and esoko's
     * own {ok:false} response comes back, which registration.js already
     * swallows (see reportProgress()'s catch-and-ignore).
     */
    public function progress(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $body = $request->get_json_params();

        return $this->relay(CecfApiClient::post(
            "/api/cecf/registration/{$request->get_param('id')}/progress",
            is_array($body) ? $body : [],
        ));
    }

    public function declarePayment(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $body = $request->get_json_params();

        return $this->relay(CecfApiClient::post(
            "/api/cecf/registration/{$request->get_param('id')}/declare-payment",
            is_array($body) ? $body : [],
        ));
    }

    public function complete(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $body = $request->get_json_params();

        return $this->relay(CecfApiClient::post(
            "/api/cecf/registration/{$request->get_param('id')}/complete",
            is_array($body) ? $body : [],
        ));
    }

    public function mpesaInitiate(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $body = $request->get_json_params();

        if (! is_array($body) || empty($body['registrationId']) || empty($body['msisdn']) || empty($body['amountKes'])) {
            return new WP_Error('cecf_bad_request', __('Missing payment details.', 'cecf-sage'), ['status' => 422]);
        }

        return $this->relay(CecfApiClient::post('/api/cecf/payments/mpesa/initiate', $body));
    }

    public function pesapalInitiate(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $body = $request->get_json_params();

        if (! is_array($body) || empty($body['registrationId']) || empty($body['amountKes']) || empty($body['returnUrl'])) {
            return new WP_Error('cecf_bad_request', __('Missing payment details.', 'cecf-sage'), ['status' => 422]);
        }

        return $this->relay(CecfApiClient::post('/api/cecf/payments/pesapal/initiate', $body));
    }

    public function paymentStatus(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        return $this->relay(CecfApiClient::get("/api/cecf/payments/{$request->get_param('id')}/status"));
    }

    /**
     * Group suggestions as someone types "yes, I belong to a group" and
     * starts naming it — lets them link straight to a real Organisation
     * instead of typing a name that never actually joins anything. See
     * resources/js/registration.js's group-search wiring.
     */
    public function groupsSearch(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $q = (string) $request->get_param('q');
        $county = (string) $request->get_param('county');

        $path = '/api/cecf/groups/search?q=' . rawurlencode($q);
        if ($county !== '') {
            $path .= '&county=' . rawurlencode($county);
        }

        return $this->relay(CecfApiClient::get($path));
    }

    /**
     * Every esoko response already carries {ok: bool, ...}; this just
     * maps esoko's own HTTP status onto the WP_REST_Response instead of
     * always answering 200, so the browser's fetch() error handling
     * (registration.js) can rely on response.ok the normal way.
     *
     * @param  array<string, mixed>  $result
     */
    protected function relay(array $result): WP_REST_Response
    {
        $status = $result['_status'] ?? 200;
        unset($result['_status']);

        if ($status === 0) {
            $status = 502; // esoko's core service was unreachable
        }

        return new WP_REST_Response($result, $status);
    }
}
