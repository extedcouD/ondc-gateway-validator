module github.com/ONDC-Official/automation-beckn-plugins

go 1.25.5

replace github.com/beckn-one/beckn-onix => github.com/ONDC-Official/automation-beckn-onix v1.5.0

replace google.golang.org/protobuf => google.golang.org/protobuf v1.32.0

replace golang.org/x/sys => golang.org/x/sys v0.38.0

replace golang.org/x/text => golang.org/x/text v0.32.0

replace validationpkg => ./ondc-validator/validationpkg

replace go.opentelemetry.io/otel => go.opentelemetry.io/otel v1.38.0

replace go.opentelemetry.io/otel/metric => go.opentelemetry.io/otel/metric v1.38.0

replace go.opentelemetry.io/otel/trace => go.opentelemetry.io/otel/trace v1.38.0

replace golang.org/x/crypto => golang.org/x/crypto v0.36.0

replace go.opentelemetry.io/auto/sdk => go.opentelemetry.io/auto/sdk v1.1.0 // indirect

require (
	github.com/beckn-one/beckn-onix v1.3.0
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.2
	validationpkg v0.0.0-00010101000000-000000000000
)

require (
	github.com/AsaiYusuke/jsonpath v1.6.0 // indirect
	github.com/beorn7/perks v1.0.1 // indirect
	github.com/bytedance/gopkg v0.1.3 // indirect
	github.com/bytedance/sonic v1.14.2 // indirect
	github.com/bytedance/sonic/loader v0.4.0 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/cloudwego/base64x v0.1.6 // indirect
	github.com/dlclark/regexp2 v1.11.5 // indirect
	github.com/go-logr/logr v1.4.3 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/klauspost/cpuid/v2 v2.2.9 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/matttproud/golang_protobuf_extensions/v2 v2.0.0 // indirect
	github.com/prometheus/client_golang v1.18.0 // indirect
	github.com/prometheus/client_model v0.6.0 // indirect
	github.com/prometheus/common v0.45.0 // indirect
	github.com/prometheus/procfs v0.12.0 // indirect
	github.com/rs/zerolog v1.34.0 // indirect
	github.com/twitchyliquid64/golang-asm v0.15.1 // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.opentelemetry.io/otel v1.39.0 // indirect
	go.opentelemetry.io/otel/exporters/prometheus v0.46.0 // indirect
	go.opentelemetry.io/otel/metric v1.39.0 // indirect
	go.opentelemetry.io/otel/sdk v1.38.0 // indirect
	go.opentelemetry.io/otel/sdk/metric v1.38.0 // indirect
	go.opentelemetry.io/otel/trace v1.39.0 // indirect
	golang.org/x/arch v0.0.0-20210923205945-b76863e36670 // indirect
	golang.org/x/sys v0.40.0 // indirect
	golang.org/x/text v0.33.0 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
	gopkg.in/natefinch/lumberjack.v2 v2.2.1 // indirect
)
