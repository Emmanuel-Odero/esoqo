<?php

namespace App\Support;

use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * The one place this theme talks to esoqo's `services/core` — the
 * `/api/cecf/*` facade described in esoqo's own
 * docs/proposals/cecf-wordpress-registration.md. Every call from this
 * theme's own `cecf/v1` REST routes (App\Providers\
 * CecfRegistrationServiceProvider) goes through here, never directly —
 * one place to get the signing right, one place to change the base URL.
 *
 * Nothing here is ever called from the browser: the browser's own JS
 * (resources/js/registration.js) talks only to this WordPress site's own
 * `cecf/v1` REST routes, same-origin. CECF_SERVICE_SECRET never leaves
 * this server.
 */
class CecfApiClient
{
    public static function baseUrl(): string
    {
        return rtrim((string) env('ESOQO_CORE_API_URL', 'http://localhost:4000'), '/');
    }

    protected static function secret(): string
    {
        $secret = env('CECF_SERVICE_SECRET');

        if (! $secret) {
            throw new RuntimeException('CECF_SERVICE_SECRET is not set — the CECF↔Esoqo facade cannot be reached.');
        }

        return (string) $secret;
    }

    /**
     * Signs the exact bytes about to be sent — esoqo's own verification
     * (services/core/src/routes/cecf.ts's verifyCecfSignature) checks the
     * literal request body, not a re-derived structure, specifically
     * because PHP's json_encode and Node's JSON.stringify don't always
     * agree on the same logical payload (Unicode escaping, float
     * formatting). Sign whatever string you are about to POST, verbatim —
     * never re-encode it afterwards. A GET request (no body) signs the
     * empty string.
     */
    public static function sign(string $body): string
    {
        return hash_hmac('sha256', $body, self::secret());
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    public static function post(string $path, array $body): array
    {
        // json_encode([]) produces "[]", not "{}" — PHP has no distinct
        // empty-object type. Every esoqo endpoint expects a JSON object
        // body (even an empty one, e.g. .../complete with no members),
        // so an empty array is cast to stdClass first.
        $json = json_encode($body === [] ? new \stdClass() : $body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($json === false) {
            throw new RuntimeException('Could not encode request body for '.$path);
        }

        try {
            $response = Http::timeout(20)
                ->withHeaders(['X-CECF-Signature' => self::sign($json)])
                ->withBody($json, 'application/json')
                ->post(self::baseUrl().$path);
        } catch (RequestException $e) {
            return ['ok' => false, '_status' => 0, 'error' => 'Could not reach the registration service. Try again in a moment.'];
        }

        return self::decode($response);
    }

    /**
     * @return array<string, mixed>
     */
    public static function get(string $path): array
    {
        try {
            $response = Http::timeout(20)
                ->withHeaders(['X-CECF-Signature' => self::sign('')])
                ->get(self::baseUrl().$path);
        } catch (RequestException $e) {
            return ['ok' => false, '_status' => 0, 'error' => 'Could not reach the registration service. Try again in a moment.'];
        }

        return self::decode($response);
    }

    /**
     * @return array<string, mixed>
     */
    protected static function decode(\Illuminate\Http\Client\Response $response): array
    {
        $data = $response->json();
        $data = is_array($data) ? $data : ['ok' => false, 'error' => 'Unexpected response from the registration service.'];
        $data['_status'] = $response->status();

        return $data;
    }
}
