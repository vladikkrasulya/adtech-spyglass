// Copyright 2026 ortbtools contributors. Synthetic direct-adapter evidence.
// Copy this file and cases.json into a fresh pinned PBS module checkout at
// ortbtools033/. Run only in the documented network-none container.
package ortbtools033

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/prebid/openrtb/v20/openrtb2"
	"github.com/prebid/prebid-server/v4/adapters"
	"github.com/prebid/prebid-server/v4/adapters/adnuntius"
	allianceGravity "github.com/prebid/prebid-server/v4/adapters/alliance_gravity"
	audienceNetwork "github.com/prebid/prebid-server/v4/adapters/audienceNetwork"
	"github.com/prebid/prebid-server/v4/adapters/gamma"
	"github.com/prebid/prebid-server/v4/adapters/goldbach"
	"github.com/prebid/prebid-server/v4/adapters/huaweiads"
	"github.com/prebid/prebid-server/v4/adapters/insticator"
	limelightDigital "github.com/prebid/prebid-server/v4/adapters/limelightDigital"
	"github.com/prebid/prebid-server/v4/adapters/lockerdome"
	"github.com/prebid/prebid-server/v4/adapters/logan"
	"github.com/prebid/prebid-server/v4/adapters/smartyads"
	"github.com/prebid/prebid-server/v4/adapters/sovrn"
	"github.com/prebid/prebid-server/v4/adapters/telaria"
	"github.com/prebid/prebid-server/v4/adapters/unicorn"
	"github.com/prebid/prebid-server/v4/config"
	"github.com/prebid/prebid-server/v4/openrtb_ext"
)

type check struct {
	Path         string      `json:"path"`
	Op           string      `json:"op"`
	Value        interface{} `json:"value"`
	OtherVariant string      `json:"otherVariant"`
	OtherPath    string      `json:"otherPath"`
}
type variant struct {
	Name   string          `json:"name"`
	Input  json.RawMessage `json:"input"`
	Checks []check         `json:"checks"`
}
type witness struct {
	ID       string    `json:"id"`
	Adapter  string    `json:"adapter"`
	Oracle   string    `json:"oracle"`
	Variants []variant `json:"variants"`
}
type fixture struct {
	Revision string    `json:"revision"`
	Cases    []witness `json:"cases"`
}
type builder func(openrtb_ext.BidderName, config.Adapter, config.Server) (adapters.Bidder, error)

var builders = map[string]builder{
	"logan": logan.Builder, "sovrn": sovrn.Builder, "insticator": insticator.Builder,
	"huaweiads": huaweiads.Builder, "telaria": telaria.Builder, "adnuntius": adnuntius.Builder,
	"gamma": gamma.Builder, "audienceNetwork": audienceNetwork.Builder, "unicorn": unicorn.Builder,
	"lockerdome": lockerdome.Builder, "smartyads": smartyads.Builder,
	"alliance_gravity": allianceGravity.Builder, "limelightDigital": limelightDigital.Builder, "goldbach": goldbach.Builder,
}

func observe(t *testing.T, name string, input json.RawMessage) map[string]interface{} {
	t.Helper()
	// Fresh unmarshal and fresh adapter for each call prevent mutation/state
	// from leaking between trigger, contrast, boundary and positive controls.
	var req openrtb2.BidRequest
	if err := json.Unmarshal(input, &req); err != nil {
		t.Fatal(err)
	}
	endpoint := "http://mock.invalid/" + name
	if name == "smartyads" {
		endpoint += "/{{.Host}}?source={{.SourceId}}&account={{.AccountID}}"
	}
	if name == "limelightDigital" {
		endpoint += "/{{.PublisherID}}?host={{.Host}}"
	}
	cfg := config.Adapter{Endpoint: endpoint, PlatformID: "synthetic-platform", AppSecret: "synthetic-app-secret"}
	if name == "insticator" {
		cfg.ExtraAdapterInfo = `{"app_endpoint":"http://mock.invalid/insticator-app"}`
	}
	if name == "huaweiads" {
		cfg.ExtraAdapterInfo = `{"closeSiteSelectionByCountry":"1"}`
	}
	if name == "adnuntius" {
		cfg.ExtraAdapterInfo = "http://mock.invalid/adnuntius-gdpr"
	}
	bidder, err := builders[name](openrtb_ext.BidderName(name), cfg, config.Server{ExternalUrl: "http://mock.invalid/server", GvlID: 1, DataCenter: "synthetic"})
	if err != nil {
		t.Fatal(err)
	}
	requests, errs := bidder.MakeRequests(&req, &adapters.ExtraRequestInfo{})
	results := make([]map[string]interface{}, 0, len(requests))
	for _, r := range requests {
		u, err := url.Parse(r.Uri)
		if err != nil || u.Hostname() != "mock.invalid" {
			t.Fatalf("non-mock endpoint generated: %q", r.Uri)
		}
		var body interface{}
		if len(r.Body) > 0 {
			if err := json.Unmarshal(r.Body, &body); err != nil {
				t.Fatalf("output body: %v", err)
			}
		} else if r.Method != "GET" {
			t.Fatal("unexpected empty non-GET body")
		}
		results = append(results, map[string]interface{}{"method": r.Method, "uri": r.Uri, "body": body, "headers": r.Headers, "impIDs": r.ImpIDs})
	}
	// Grouped Go-map fanout is compared by semantic content, never map order.
	sort.Slice(results, func(i, j int) bool {
		a, _ := json.Marshal(results[i])
		b, _ := json.Marshal(results[j])
		return string(a) < string(b)
	})
	errors := make([]string, 0, len(errs))
	for _, err := range errs {
		errors = append(errors, err.Error())
	}
	bodyIDs := []string{}
	bodyImpIDsByID := map[string][]string{}
	for _, r := range results {
		if body, ok := r["body"].(map[string]interface{}); ok {
			if id, ok := body["id"].(string); ok {
				bodyIDs = append(bodyIDs, id)
				ids := []string{}
				if imps, ok := body["imp"].([]interface{}); ok {
					for _, imp := range imps {
						if obj, ok := imp.(map[string]interface{}); ok {
							if id, ok := obj["id"].(string); ok {
								ids = append(ids, id)
							}
						}
					}
				}
				bodyImpIDsByID[id] = ids
			}
		}
	}
	sort.Strings(bodyIDs)
	observation := map[string]interface{}{"requests": results, "requestCount": len(results), "errors": errors, "errorCount": len(errors), "bodyIDs": bodyIDs, "bodyImpIDsByID": bodyImpIDsByID}
	raw, err := json.Marshal(observation)
	if err != nil {
		t.Fatal(err)
	}
	var normalized map[string]interface{}
	if err := json.Unmarshal(raw, &normalized); err != nil {
		t.Fatal(err)
	}
	return normalized
}

func pointer(value interface{}, path string) (interface{}, bool) {
	if path == "" {
		return value, true
	}
	for _, part := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		part = strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
		switch v := value.(type) {
		case map[string]interface{}:
			var ok bool
			value, ok = v[part]
			if !ok {
				return nil, false
			}
		case []interface{}:
			n, err := strconv.Atoi(part)
			if err != nil || n < 0 || n >= len(v) {
				return nil, false
			}
			value = v[n]
		default:
			return nil, false
		}
	}
	return value, true
}

func TestFrozenWitnesses(t *testing.T) {
	data, err := os.ReadFile("cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixture
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	if f.Revision != "0ba352315253f6692af6497d553cfb12909a1b8b" || len(f.Cases) != 19 {
		t.Fatal("unexpected frozen source or membership")
	}
	reports := []map[string]interface{}{}
	for _, w := range f.Cases {
		report := map[string]interface{}{"id": w.ID, "adapter": w.Adapter, "oracle": w.Oracle, "outcome": "fail"}
		t.Run(w.ID, func(t *testing.T) {
			if builders[w.Adapter] == nil {
				t.Fatal("unknown adapter")
			}
			observed := map[string]interface{}{}
			names := map[string]bool{}
			for _, v := range w.Variants {
				if names[v.Name] {
					t.Fatal("duplicate variant")
				}
				names[v.Name] = true
				observed[v.Name] = observe(t, w.Adapter, v.Input)
			}
			if !names["control"] || !names["trigger"] || !names["contrast"] {
				t.Fatal("missing control or pair")
			}
			report["observations"] = observed
			count := 0
			for _, v := range w.Variants {
				for _, c := range v.Checks {
					count++
					actual, present := pointer(observed[v.Name], c.Path)
					expected := c.Value
					if c.OtherVariant != "" {
						var ok bool
						expected, ok = pointer(observed[c.OtherVariant], c.OtherPath)
						if !ok {
							t.Errorf("comparison target missing %s %s", c.OtherVariant, c.OtherPath)
							continue
						}
					}
					pass := false
					switch c.Op {
					case "eq":
						pass = present && reflect.DeepEqual(actual, expected)
					case "ne":
						pass = present && !reflect.DeepEqual(actual, expected)
					case "contains":
						pass = present && strings.Contains(fmt.Sprint(actual), fmt.Sprint(expected))
					case "absent":
						pass = !present
					case "atLeast":
						a, aok := actual.(float64)
						b, bok := expected.(float64)
						pass = present && aok && bok && a >= b
					default:
						t.Fatalf("unknown check %s", c.Op)
					}
					if !pass {
						t.Errorf("%s %s %s: got %#v, expected %#v", v.Name, c.Path, c.Op, actual, expected)
					}
				}
			}
			report["assertions"] = count
			if !t.Failed() {
				report["outcome"] = "pass"
			}
		})
		reports = append(reports, report)
	}
	if path := os.Getenv("ORTBTOOLS_WITNESS_OUTPUT"); path != "" {
		data, err := json.MarshalIndent(map[string]interface{}{"revision": f.Revision, "records": reports}, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(data, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
}
